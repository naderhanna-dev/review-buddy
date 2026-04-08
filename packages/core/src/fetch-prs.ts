import {
  classifyPullRequest,
  formatRelativeTime,
  prViewKey,
  sortByUpdatedDesc,
  type ActivitySignals,
  type CheckStatus,
  type PolicyBotStatus,
  type PullDetails,
  type PullRequest,
  type Review,
} from "./classification";
import {
  graphqlFetch,
  type GqlMergedPullRequestNode,
  type GqlPullRequestNode,
  type GqlSearchResponse,
  type GqlTeamsResponse,
  PR_CHECKS_QUERY,
  PR_DETAILS_FRAGMENT,
  SEARCH_OPEN_PRS_QUERY,
  VIEWER_AND_TEAMS_QUERY,
} from "./graphql";
import type { ClassifiedPullRequests, MergedPullRequest, StalePreference } from "./types";
import {
  SEARCH_PAGE_SIZE,
  SEARCH_MAX_PAGES,
  BATCH_SEARCH_CHUNK_SIZE,
  MERGED_COUNT_MAX,
  STALE_AFTER_MS,
} from "./constants";
import { sortByPriorityAndUpdated } from "./pr-utils";

export async function fetchViewerLogin(token: string): Promise<string> {
  const result = await graphqlFetch<{ viewer: { login: string } }>(
    "query { viewer { login } }",
    {},
    token,
  );
  return result.viewer.login;
}

export async function fetchAndClassifyPullRequests(
  org: string,
  token: string,
  viewerLogin: string,
  viewedMap: Record<string, number>,
  stalePreferences: Record<string, StalePreference>,
): Promise<ClassifiedPullRequests> {
  let teamsData: GqlTeamsResponse;
  let teamSignalsUnavailable: string | null = null;

  try {
    teamsData = await graphqlFetch<GqlTeamsResponse>(
      VIEWER_AND_TEAMS_QUERY,
      { org, login: viewerLogin },
      token,
    );
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    teamSignalsUnavailable =
      `Could not fetch team memberships (${detail}). ` +
      'Ensure the token has the "Members: Read" organization permission ' +
      "and that the Resource owner is set to your org.";
    teamsData = {
      viewer: { login: viewerLogin, databaseId: 0, avatarUrl: "", url: "" },
      organization: null,
    };
  }

  const me = teamsData.viewer;
  const myTeamSlugs = new Set(
    (teamsData.organization?.teams.nodes ?? []).map((team) => team.slug),
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

  function buildBatchSearchQuery(queries: string[], fragment: string): string {
    const aliases = queries.map((query, i) => {
      const escapedQuery = query.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `s${i}: search(query: "${escapedQuery}", type: ISSUE, first: ${SEARCH_PAGE_SIZE}) {
      issueCount
      pageInfo { hasNextPage endCursor }
      nodes { ... on PullRequest { ${fragment} } }
    }`;
    });
    return `query BatchSearch { ${aliases.join("\n")} }`;
  }

  const prMap = new Map<number, GqlPullRequestNode>();
  const needsPagination: Array<{ query: string; cursor: string }> = [];

  type BatchSearchResult = Record<
    string,
    {
      issueCount: number;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: Array<GqlPullRequestNode | null>;
    }
  >;

  const chunks: string[][] = [];
  for (let i = 0; i < candidateQueries.length; i += BATCH_SEARCH_CHUNK_SIZE) {
    chunks.push(candidateQueries.slice(i, i + BATCH_SEARCH_CHUNK_SIZE));
  }

  let globalIndex = 0;
  for (const chunk of chunks) {
    const batchQuery = buildBatchSearchQuery(chunk, PR_DETAILS_FRAGMENT);
    const batchResult = await graphqlFetch<BatchSearchResult>(batchQuery, {}, token);

    for (let i = 0; i < chunk.length; i++) {
      const result = batchResult[`s${i}`];
      if (!result) {
        globalIndex++;
        continue;
      }

      for (const node of result.nodes) {
        if (node && !prMap.has(node.databaseId)) {
          prMap.set(node.databaseId, node);
        }
      }

      if (result.pageInfo.hasNextPage && result.pageInfo.endCursor) {
        needsPagination.push({
          query: candidateQueries[globalIndex],
          cursor: result.pageInfo.endCursor,
        });
      }
      globalIndex++;
    }
  }

  for (const { query, cursor } of needsPagination) {
    let currentCursor: string | null = cursor;
    for (let page = 1; page < SEARCH_MAX_PAGES; page++) {
      const pageResult: GqlSearchResponse<GqlPullRequestNode> =
        await graphqlFetch<GqlSearchResponse<GqlPullRequestNode>>(
        SEARCH_OPEN_PRS_QUERY,
        { query, first: SEARCH_PAGE_SIZE, after: currentCursor ?? undefined },
        token,
      );

      for (const node of pageResult.search.nodes) {
        if (node && !prMap.has(node.databaseId)) {
          prMap.set(node.databaseId, node);
        }
      }

      if (!pageResult.search.pageInfo.hasNextPage) {
        break;
      }
      currentCursor = pageResult.search.pageInfo.endCursor;
    }
  }

  const viewedKeysToFetch: Array<{
    owner: string;
    name: string;
    number: number;
    viewKey: string;
  }> = [];

  for (const key of Object.keys(viewedMap)) {
    const [repository, numberStr] = key.split("#");
    if (!repository || !numberStr) {
      continue;
    }
    if (!repository.toLowerCase().startsWith(`${org.toLowerCase()}/`)) {
      continue;
    }

    const prNumber = parseInt(numberStr, 10);
    if (isNaN(prNumber)) {
      continue;
    }

    const alreadyFetched = Array.from(prMap.values()).some(
      (node) =>
        node.baseRepository?.nameWithOwner.toLowerCase() ===
          repository.toLowerCase() && node.number === prNumber,
    );
    if (alreadyFetched) {
      continue;
    }

    const [owner, name] = repository.split("/");
    if (!owner || !name) {
      continue;
    }

    viewedKeysToFetch.push({ owner, name, number: prNumber, viewKey: key });
  }

  for (let i = 0; i < viewedKeysToFetch.length; i += BATCH_SEARCH_CHUNK_SIZE) {
    const chunk = viewedKeysToFetch.slice(i, i + BATCH_SEARCH_CHUNK_SIZE);

    const aliases = chunk.map(({ owner, name, number, viewKey }) => {
      const alias = `pr_${viewKey.replace(/[^a-zA-Z0-9]/g, "_")}`;
      return `${alias}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) {
        pullRequest(number: ${number}) {
          ${PR_DETAILS_FRAGMENT}
        }
      }`;
    });

    const batchQuery = `query BatchViewedPRs { ${aliases.join("\n")} }`;

    try {
      const batchResult = await graphqlFetch<
        Record<string, { pullRequest: GqlPullRequestNode | null }>
      >(batchQuery, {}, token);

      for (const { viewKey } of chunk) {
        const alias = `pr_${viewKey.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const repoResult = batchResult[alias];
        const pullNode = repoResult?.pullRequest;
        if (pullNode && !prMap.has(pullNode.databaseId)) {
          prMap.set(pullNode.databaseId, pullNode);
        }
      }
    } catch {
      // Silently ignore batch fetch failures for locally-viewed PRs — they will be cleaned up on next full refresh
    }
  }

  const yourPrs: PullRequest[] = [];
  const needsAttention: PullRequest[] = [];
  const relatedToYou: PullRequest[] = [];
  const stalePrs: PullRequest[] = [];
  const closedViewedKeys: string[] = [];
  const nowMs = Date.now();

  for (const pull of prMap.values()) {
    const viewKey = prViewKey(pull.baseRepository?.nameWithOwner ?? "", pull.number);

    if (pull.state !== "OPEN" || pull.mergedAt !== null) {
      if (viewedMap[viewKey] !== undefined) {
        closedViewedKeys.push(viewKey);
      }
      continue;
    }

    const viewedAtMs = viewedMap[viewKey];
    const normalizedLogin = me.login.toLowerCase();
    const reviews = pull.reviews.nodes;
    const pullComments = pull.comments.nodes;

    let checkState: PullRequest["checkState"] = "pending";
    let policyBotStatus: PolicyBotStatus | undefined;

    const latestCommit = pull.commits?.nodes[0]?.commit;
    if (latestCommit?.statusCheckRollup) {
      const rollup = latestCommit.statusCheckRollup;
      if (rollup.state === "SUCCESS") {
        checkState = "success";
      } else if (rollup.state === "FAILURE" || rollup.state === "ERROR") {
        checkState = "failure";
      }

      const policyEntry = rollup.contexts.nodes.find(
        (
          node,
        ): node is {
          __typename: "StatusContext";
          context: string;
          state: string;
          targetUrl: string | null;
          description: string | null;
        } =>
          node.__typename === "StatusContext" &&
          "context" in node &&
          node.context.toLowerCase().startsWith("policy-bot"),
      );

      if (policyEntry) {
        const status = policyEntry.state.toLowerCase();
        const policyState: PolicyBotStatus["state"] =
          status === "success"
            ? "success"
            : status === "failure" || status === "error"
              ? "failure"
              : "pending";
        policyBotStatus = {
          state: policyState,
          url: policyEntry.targetUrl,
          description: policyEntry.description,
        };
      }
    }


    const myLatestReview = reviews
      .filter(
        (review) =>
          review.author?.login?.toLowerCase() === normalizedLogin &&
          Boolean(review.submittedAt),
      )
      .sort(
        (a, b) =>
          new Date(b.submittedAt ?? 0).getTime() -
          new Date(a.submittedAt ?? 0).getTime(),
      )[0];

    const lastReviewAtMs = myLatestReview?.submittedAt
      ? new Date(myLatestReview.submittedAt).getTime()
      : undefined;

    const hasNewCommitsSinceMyReview =
      lastReviewAtMs !== undefined &&
      Boolean(myLatestReview?.commit?.oid) &&
      myLatestReview.commit?.oid !== pull.headRefOid;

    const hasNewCommentsSinceMyReview =
      lastReviewAtMs !== undefined &&
      (reviews.some(
        (review) =>
          review.author?.login?.toLowerCase() !== normalizedLogin &&
          Boolean(review.submittedAt) &&
          new Date(review.submittedAt as string).getTime() > lastReviewAtMs,
      ) ||
        pullComments.some(
          (comment) =>
            comment.author?.login?.toLowerCase() !== normalizedLogin &&
            new Date(comment.createdAt).getTime() > lastReviewAtMs,
        ));

    const hasNewReviewsSinceViewed =
      viewedAtMs !== undefined &&
      reviews.some(
        (review) =>
          review.author?.login?.toLowerCase() !== normalizedLogin &&
          Boolean(review.submittedAt) &&
          new Date(review.submittedAt as string).getTime() > viewedAtMs,
      );

    const hasNewCommentsSinceViewed =
      viewedAtMs !== undefined &&
      pullComments.some(
        (comment) =>
          comment.author?.login?.toLowerCase() !== normalizedLogin &&
          new Date(comment.createdAt).getTime() > viewedAtMs,
      );

    const latestReviewVerdict =
      (reviews
        .filter(
          (review) =>
            review.author?.login?.toLowerCase() !== normalizedLogin &&
            Boolean(review.submittedAt) &&
            (review.state === "APPROVED" ||
              review.state === "CHANGES_REQUESTED"),
        )
        .sort(
          (a, b) =>
            new Date(b.submittedAt ?? 0).getTime() -
            new Date(a.submittedAt ?? 0).getTime(),
        )[0]?.state as "APPROVED" | "CHANGES_REQUESTED" | undefined) ?? null;

    const activitySignals: ActivitySignals = {
      hasNewCommitsSinceMyReview,
      hasNewCommentsSinceMyReview,
      hasNewReviewsSinceViewed,
      hasNewCommentsSinceViewed,
      latestReviewVerdict,
    };

    const classification = classifyPullRequest(
      pull as PullDetails,
      reviews as Review[],
      me.login,
      myTeamSlugs,
      viewedAtMs,
      activitySignals,
    );

    const stalePreference = stalePreferences[viewKey];
    const isAutoStale =
      nowMs - new Date(pull.updatedAt).getTime() >= STALE_AFTER_MS;
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
  viewerLogin: string,
): Promise<MergedPullRequest[]> {
  const authorQuery = `is:pr is:merged archived:false org:${org} author:${viewerLogin}`;
  const reviewerQuery = `is:pr is:merged archived:false org:${org} reviewed-by:${viewerLogin}`;

  const perQueryLimit = Math.min(limit * 2, MERGED_COUNT_MAX);

  const escapedAuthorQuery = authorQuery.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const escapedReviewerQuery = reviewerQuery
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');

  const mergedBatchQuery = `query BatchMergedSearch {
  authored: search(query: "${escapedAuthorQuery}", type: ISSUE, first: ${perQueryLimit}) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        databaseId
        number
        title
        url
        mergedAt
        author { login avatarUrl url }
        baseRepository { nameWithOwner url }
      }
    }
  }
  reviewed: search(query: "${escapedReviewerQuery}", type: ISSUE, first: ${perQueryLimit}) {
    issueCount
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        databaseId
        number
        title
        url
        mergedAt
        author { login avatarUrl url }
        baseRepository { nameWithOwner url }
      }
    }
  }
}`;

  const mergedResult = await graphqlFetch<{
    authored: { nodes: Array<GqlMergedPullRequestNode | null> };
    reviewed: { nodes: Array<GqlMergedPullRequestNode | null> };
  }>(mergedBatchQuery, {}, token);

  const allPrs = new Map<
    number,
    { pr: GqlMergedPullRequestNode; role: "author" | "reviewed" }
  >();

  for (const node of mergedResult.authored.nodes) {
    if (node) {
      allPrs.set(node.databaseId, { pr: node, role: "author" });
    }
  }
  for (const node of mergedResult.reviewed.nodes) {
    if (node && !allPrs.has(node.databaseId)) {
      allPrs.set(node.databaseId, { pr: node, role: "reviewed" });
    }
  }

  return Array.from(allPrs.values())
    .filter(({ pr }) => pr.mergedAt !== null)
    .sort(
      (a, b) =>
        new Date(b.pr.mergedAt as string).getTime() -
        new Date(a.pr.mergedAt as string).getTime(),
    )
    .slice(0, limit)
    .map(({ pr, role }) => ({
      id: pr.databaseId,
      number: pr.number,
      title: pr.title,
      repository: pr.baseRepository?.nameWithOwner ?? "",
      repositoryUrl: pr.baseRepository?.url ?? "",
      author: pr.author?.login ?? "",
      authorAvatarUrl: pr.author?.avatarUrl ?? "",
      authorProfileUrl: pr.author?.url ?? "",
      url: pr.url,
      mergedAt: formatRelativeTime(pr.mergedAt as string),
      mergedAtIso: pr.mergedAt as string,
      role,
    }));
}

type PRChecksContextNode =
  | { __typename: 'StatusContext'; context: string; state: string; targetUrl: string | null; description: string | null }
  | { __typename: 'CheckRun'; name: string; status: string; conclusion: string | null; detailsUrl: string | null }
  | { __typename: string }

type PRChecksResponse = {
  repository: {
    pullRequest: {
      headRefOid: string
      headRef: {
        target: {
          statusCheckRollup: {
            contexts: {
              nodes: Array<PRChecksContextNode>
            }
          } | null
        } | null
      } | null
    } | null
  } | null
}

async function fetchCheckRunsViaRest(
  owner: string,
  name: string,
  sha: string,
  token: string,
): Promise<CheckStatus[]> {
  type RestCheckRun = { name: string; status: string; conclusion: string | null; details_url: string | null }

  const allRuns: RestCheckRun[] = []
  let url: string | null = `https://api.github.com/repos/${owner}/${name}/commits/${sha}/check-runs?per_page=100`

  while (url) {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    })
    if (response.status === 401) {
      throw new Error('Check details unavailable — your GitHub token is invalid or has expired.')
    }
    if (response.status === 403) {
      throw new Error('Check details unavailable — your token needs the "checks:read" permission (or a classic PAT with repo scope).')
    }
    if (!response.ok) {
      throw new Error(`Failed to fetch check runs (${response.status} ${response.statusText}).`)
    }
    const data = await response.json() as { check_runs: RestCheckRun[] }
    allRuns.push(...data.check_runs)
    const linkHeader = response.headers.get('link')
    const nextMatch = linkHeader?.match(/<([^>]+)>;\s*rel="next"/)
    url = nextMatch?.[1] ?? null
  }

  return allRuns.flatMap((run): CheckStatus[] => {
    const conclusion = run.conclusion?.toLowerCase() ?? null
    if (conclusion === 'success' || conclusion === 'skipped' || conclusion === 'neutral') { return [] }
    const state: CheckStatus['state'] = conclusion === null ? 'pending'
      : (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure' || conclusion === 'action_required') ? 'failure'
      : 'error'
    return [{ name: run.name, state, url: run.details_url, description: null }]
  })
}

export async function fetchPRCheckStatuses(
  repository: string,
  number: number,
  token: string,
): Promise<CheckStatus[]> {
  const slashIndex = repository.indexOf('/')
  if (slashIndex === -1) { return [] }
  const owner = repository.slice(0, slashIndex)
  const name = repository.slice(slashIndex + 1)

  const result = await graphqlFetch<PRChecksResponse>(
    PR_CHECKS_QUERY,
    { owner, name, number },
    token,
  )

  const pullRequest = result.repository?.pullRequest
  const headRefOid = pullRequest?.headRefOid
  const rollup = pullRequest?.headRef?.target?.statusCheckRollup

  if (rollup === null || rollup === undefined) {
    if (!headRefOid) { return [] }
    return fetchCheckRunsViaRest(owner, name, headRefOid, token)
  }

  const nodes = rollup.contexts.nodes

  return nodes.flatMap((node): CheckStatus[] => {
    if (node.__typename === 'StatusContext' && 'context' in node) {
      if (node.state === 'SUCCESS') { return [] }
      let statusContextState: CheckStatus['state']
      switch (node.state) {
        case 'PENDING':
        case 'EXPECTED':
          statusContextState = 'pending'
          break
        case 'FAILURE':
          statusContextState = 'failure'
          break
        case 'ERROR':
        default:
          statusContextState = 'error'
      }
      return [{ name: node.context, state: statusContextState, url: node.targetUrl, description: node.description }]
    }
    if (node.__typename === 'CheckRun' && 'name' in node) {
      const conclusion = node.conclusion?.toLowerCase() ?? null
      if (conclusion === 'success' || conclusion === 'skipped' || conclusion === 'neutral') { return [] }
      const state: CheckStatus['state'] = conclusion === null ? 'pending'
        : (conclusion === 'failure' || conclusion === 'timed_out' || conclusion === 'startup_failure' || conclusion === 'action_required') ? 'failure'
        : 'error'
      return [{ name: node.name, state, url: node.detailsUrl, description: null }]
    }
    return []
  })
}
