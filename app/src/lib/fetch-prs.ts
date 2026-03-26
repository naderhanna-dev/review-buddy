import {
  classifyPullRequest,
  formatRelativeTime,
  prViewKey,
  sortByUpdatedDesc,
  type ActivitySignals,
  type PolicyBotStatus,
  type PullDetails,
  type PullRequest,
  type Review,
} from "./classification";
import {
  apiFetch,
  type CombinedStatusResponse,
  type GitHubUser,
  type PullComment,
  type SearchIssuesResponse,
  type Team,
} from "./github";
import { etagCache } from "./etag-cache";
import { withRetry } from "./retry";
import type { ClassifiedPullRequests, MergedPullRequest, StalePreference } from "../types";
import {
  SEARCH_PAGE_SIZE,
  SEARCH_MAX_PAGES,
  STALE_AFTER_MS,
} from "../constants";
import { sortByPriorityAndUpdated } from "./pr-utils";

export async function fetchAndClassifyPullRequests(
  org: string,
  token: string,
  viewedMap: Record<string, number>,
  stalePreferences: Record<string, StalePreference>,
): Promise<ClassifiedPullRequests> {
  const me = await apiFetch<GitHubUser>(
    "https://api.github.com/user",
    token,
    etagCache,
  );

  async function searchPullRequestUrls(query: string): Promise<Set<string>> {
    const urls = new Set<string>();

    for (let page = 1; page <= SEARCH_MAX_PAGES; page += 1) {
      const encodedQuery = encodeURIComponent(query);
      const response = await apiFetch<SearchIssuesResponse>(
        `https://api.github.com/search/issues?q=${encodedQuery}&sort=updated&order=desc&per_page=${SEARCH_PAGE_SIZE}&page=${page}`,
        token,
        etagCache,
      );

      for (const item of response.items) {
        if (item.pull_request?.url) {
          urls.add(item.pull_request.url);
        }
      }

      if (response.items.length < SEARCH_PAGE_SIZE) {
        break;
      }
    }

    return urls;
  }

  let teams: Team[] = [];
  let teamSignalsUnavailable: string | null = null;

  try {
    teams = await apiFetch<Team[]>(
      "https://api.github.com/user/teams?per_page=100",
      token,
      etagCache,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    teamSignalsUnavailable =
      `Could not fetch team memberships (${detail}). ` +
      'Ensure the token has the "Members: Read" organization permission ' +
      "and that the Resource owner is set to your org.";
  }

  const myTeamSlugs = new Set(
    teams
      .filter(
        (team) => team.organization.login.toLowerCase() === org.toLowerCase(),
      )
      .map((team) => team.slug),
  );

  if (!teamSignalsUnavailable && myTeamSlugs.size === 0) {
    teamSignalsUnavailable =
      "No team memberships found for this org. If you belong to teams, verify " +
      "that your token's Resource owner is set to the org (not your personal account) " +
      'and that it has the "Members: Read" organization permission.';
  }

  const candidateQueries = [
    `is:pr is:open archived:false org:${org} review-requested:${me.login}`,
    `is:pr is:open archived:false org:${org} reviewed-by:${me.login}`,
    `is:pr is:open archived:false org:${org} author:${me.login}`,
    `is:pr is:open archived:false org:${org} assignee:${me.login}`,
  ];

  for (const teamSlug of myTeamSlugs) {
    candidateQueries.push(
      `is:pr is:open archived:false org:${org} team-review-requested:${org}/${teamSlug}`,
    );
  }

  const candidateUrlSets = await Promise.all(
    candidateQueries.map((query) => searchPullRequestUrls(query)),
  );

  const pullUrls = new Set<string>();
  for (const urlSet of candidateUrlSets) {
    for (const url of urlSet) {
      pullUrls.add(url);
    }
  }

  for (const key of Object.keys(viewedMap)) {
    const [repository, number] = key.split("#");
    if (!repository || !number) {
      continue;
    }

    if (!repository.toLowerCase().startsWith(`${org.toLowerCase()}/`)) {
      continue;
    }
    pullUrls.add(`https://api.github.com/repos/${repository}/pulls/${number}`);
  }

  const pullsWithReviews = await Promise.all(
    Array.from(pullUrls).map(async (pullUrl) => {
      const [pull, reviews, pullComments] = await Promise.all([
        withRetry(() => apiFetch<PullDetails>(pullUrl, token, etagCache)),
        withRetry(() =>
          apiFetch<Review[]>(`${pullUrl}/reviews?per_page=100`, token, etagCache),
        ),
        withRetry(() =>
          apiFetch<PullComment[]>(`${pullUrl}/comments?per_page=100`, token, etagCache),
        ),
      ]);

      let checkState: PullRequest["checkState"] = "pending";
      let policyBotStatus: PolicyBotStatus | undefined;

      try {
        const combinedStatus = await withRetry(() => apiFetch<CombinedStatusResponse>(
          `https://api.github.com/repos/${pull.base.repo.full_name}/commits/${pull.head.sha}/status`,
          token,
          etagCache,
        ));

        if (combinedStatus.state === "success") {
          checkState = "success";
        } else if (
          combinedStatus.state === "failure" ||
          combinedStatus.state === "error"
        ) {
          checkState = "failure";
        }

        const policyEntry = combinedStatus.statuses.find((s) =>
          s.context.toLowerCase().startsWith("policy-bot"),
        );
        if (policyEntry) {
          const policyState: PolicyBotStatus["state"] =
            policyEntry.state === "success"
              ? "success"
              : policyEntry.state === "failure" || policyEntry.state === "error"
                ? "failure"
                : "pending";
          policyBotStatus = {
            state: policyState,
            url: policyEntry.target_url,
            description: policyEntry.description,
          };
        }
      } catch {
        checkState = "pending";
      }

      return { pull, reviews, pullComments, checkState, policyBotStatus };
    }),
  );

  const yourPrs: PullRequest[] = [];
  const needsAttention: PullRequest[] = [];
  const relatedToYou: PullRequest[] = [];
  const stalePrs: PullRequest[] = [];
  const closedViewedKeys: string[] = [];
  const nowMs = Date.now();

  for (const { pull, reviews, pullComments, checkState, policyBotStatus } of pullsWithReviews) {
    const viewKey = prViewKey(pull.base.repo.full_name, pull.number);

    if (pull.state !== "open" || pull.merged_at !== null) {
      if (viewedMap[viewKey] !== undefined) {
        closedViewedKeys.push(viewKey);
      }
      continue;
    }

    const viewedAtMs = viewedMap[viewKey];
    const normalizedLogin = me.login.toLowerCase();

    const myLatestReview = reviews
      .filter(
        (review) =>
          review.user?.login?.toLowerCase() === normalizedLogin &&
          Boolean(review.submitted_at),
      )
      .sort(
        (a, b) =>
          new Date(b.submitted_at ?? 0).getTime() -
          new Date(a.submitted_at ?? 0).getTime(),
      )[0];

    const lastReviewAtMs = myLatestReview?.submitted_at
      ? new Date(myLatestReview.submitted_at).getTime()
      : undefined;
    const hasNewCommitsSinceMyReview =
      lastReviewAtMs !== undefined &&
      Boolean(myLatestReview?.commit_id) &&
      myLatestReview.commit_id !== pull.head.sha;

    const hasNewCommentsSinceMyReview =
      lastReviewAtMs !== undefined &&
      (reviews.some(
        (review) =>
          review.user?.login?.toLowerCase() !== normalizedLogin &&
          Boolean(review.submitted_at) &&
          new Date(review.submitted_at as string).getTime() > lastReviewAtMs,
      ) ||
        pullComments.some(
          (comment) =>
            comment.user?.login?.toLowerCase() !== normalizedLogin &&
            new Date(comment.created_at).getTime() > lastReviewAtMs,
        ));

    const hasNewReviewsSinceViewed =
      viewedAtMs !== undefined &&
      reviews.some(
        (review) =>
          review.user?.login?.toLowerCase() !== normalizedLogin &&
          Boolean(review.submitted_at) &&
          new Date(review.submitted_at as string).getTime() > viewedAtMs,
      );

    const hasNewCommentsSinceViewed =
      viewedAtMs !== undefined &&
      pullComments.some(
        (comment) =>
          comment.user?.login?.toLowerCase() !== normalizedLogin &&
          new Date(comment.created_at).getTime() > viewedAtMs,
      );

    const latestReviewVerdict =
      (reviews
        .filter(
          (review) =>
            review.user?.login?.toLowerCase() !== normalizedLogin &&
            Boolean(review.submitted_at) &&
            (review.state === "APPROVED" ||
              review.state === "CHANGES_REQUESTED"),
        )
        .sort(
          (a, b) =>
            new Date(b.submitted_at ?? 0).getTime() -
            new Date(a.submitted_at ?? 0).getTime(),
        )[0]?.state as "APPROVED" | "CHANGES_REQUESTED" | undefined) ?? null;

    const activitySignals: ActivitySignals = {
      hasNewCommitsSinceMyReview,
      hasNewCommentsSinceMyReview,
      hasNewReviewsSinceViewed,
      hasNewCommentsSinceViewed,
      latestReviewVerdict: latestReviewVerdict ?? null,
    };

    const classification = classifyPullRequest(
      pull,
      reviews,
      me.login,
      myTeamSlugs,
      viewedAtMs,
      activitySignals,
    );

    const stalePreference = stalePreferences[viewKey];
    const isAutoStale =
      nowMs - new Date(pull.updated_at).getTime() >= STALE_AFTER_MS;
    const isStale =
      stalePreference === "stale" ||
      (stalePreference !== "active" && isAutoStale);
    const staleState = stalePreference === "stale" ? "manual" : "auto";

    if (classification.yourPrs) {
      const nextPr = { ...classification.yourPrs, checkState, policyBotStatus };
      if (isStale) {
        stalePrs.push({ ...nextPr, staleState });
      } else {
        yourPrs.push(nextPr);
      }
      continue;
    }

    if (classification.needsAttention) {
      const nextPr = {
        ...classification.needsAttention,
        checkState,
        policyBotStatus,
      };
      if (isStale) {
        stalePrs.push({ ...nextPr, staleState });
      } else {
        needsAttention.push(nextPr);
      }
      continue;
    }

    if (classification.relatedToYou) {
      const nextPr = {
        ...classification.relatedToYou,
        checkState,
        policyBotStatus,
      };
      if (isStale) {
        stalePrs.push({ ...nextPr, staleState });
      } else {
        relatedToYou.push(nextPr);
      }
    }
  }

  return {
    yourPrs: sortByPriorityAndUpdated(yourPrs, {
      "your-pr-new-reviews": 0,
      "your-pr-new-comments": 1,
      "your-pr-unseen-reviews": 2,
      "your-pr-changes-requested": 3,
      "your-pr-approved": 4,
      "your-pr-no-activity": 5,
    }),
    needsAttention: sortByPriorityAndUpdated(needsAttention, {
      "new-updates": 0,
      "new-comments": 1,
      "review-requested": 2,
    }),
    relatedToYou: sortByUpdatedDesc(relatedToYou),
    stalePrs: sortByUpdatedDesc(stalePrs),
    teamSignalsUnavailable,
    closedViewedKeys,
  };
}

export async function fetchRecentlyMergedPRs(
  org: string,
  token: string,
  limit: number,
): Promise<MergedPullRequest[]> {
  const me = await apiFetch<GitHubUser>(
    "https://api.github.com/user",
    token,
    etagCache,
  );

  const authorQuery = `is:pr is:merged archived:false org:${org} author:${me.login}`;
  const reviewerQuery = `is:pr is:merged archived:false org:${org} reviewed-by:${me.login}`;

  const perQueryLimit = Math.min(limit * 2, SEARCH_PAGE_SIZE);

  const [authorResponse, reviewerResponse] = await Promise.all([
    apiFetch<SearchIssuesResponse>(
      `https://api.github.com/search/issues?q=${encodeURIComponent(authorQuery)}&sort=updated&order=desc&per_page=${perQueryLimit}`,
      token,
      etagCache,
    ),
    apiFetch<SearchIssuesResponse>(
      `https://api.github.com/search/issues?q=${encodeURIComponent(reviewerQuery)}&sort=updated&order=desc&per_page=${perQueryLimit}`,
      token,
      etagCache,
    ),
  ]);

  const allUrls = new Map<string, "author" | "reviewed">();
  for (const item of authorResponse.items) {
    if (item.pull_request?.url) {
      allUrls.set(item.pull_request.url, "author");
    }
  }
  for (const item of reviewerResponse.items) {
    if (item.pull_request?.url && !allUrls.has(item.pull_request.url)) {
      allUrls.set(item.pull_request.url, "reviewed");
    }
  }

  const pulls = await Promise.all(
    Array.from(allUrls.entries()).map(async ([pullUrl, role]) => {
      const pull = await apiFetch<PullDetails>(pullUrl, token, etagCache);
      return { pull, role };
    }),
  );

  return pulls
    .filter(({ pull }) => pull.merged_at !== null)
    .sort(
      (a, b) =>
        new Date(b.pull.merged_at as string).getTime() -
        new Date(a.pull.merged_at as string).getTime(),
    )
    .slice(0, limit)
    .map(({ pull, role }) => ({
      id: pull.id,
      number: pull.number,
      title: pull.title,
      repository: pull.base.repo.full_name,
      repositoryUrl: pull.base.repo.html_url,
      author: pull.user.login,
      authorAvatarUrl: pull.user.avatar_url,
      authorProfileUrl: pull.user.html_url,
      url: pull.html_url,
      mergedAt: formatRelativeTime(pull.merged_at as string),
      mergedAtIso: pull.merged_at as string,
      role,
    }));
}
