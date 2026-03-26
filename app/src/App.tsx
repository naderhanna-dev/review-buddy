import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  type ActivitySignals,
  classifyPullRequest,
  formatRelativeTime,
  prViewKey,
  sortByCreatedAt,
  sortByUpdatedDesc,
  type PolicyBotStatus,
  type PullDetails,
  type PullRequest,
  type Review,
} from "./lib/classification";
import {
  apiFetch,
  type CombinedStatusResponse,
  type GitHubUser,
  type PullComment,
  RateLimitError,
  type SearchIssuesResponse,
  type Team,
} from "./lib/github";
import { etagCache } from "./lib/etag-cache";
import { SmartRefreshController } from "./lib/smart-refresh";
import "./App.css";

type ClassifiedPullRequests = {
  yourPrs: PullRequest[];
  needsAttention: PullRequest[];
  relatedToYou: PullRequest[];
  stalePrs: PullRequest[];
  teamSignalsUnavailable: string | null;
  closedViewedKeys: string[];
}

type MergedPullRequest = {
  id: number;
  number: number;
  title: string;
  repository: string;
  repositoryUrl: string;
  author: string;
  authorAvatarUrl: string;
  authorProfileUrl: string;
  url: string;
  mergedAt: string;
  mergedAtIso: string;
  role: "author" | "reviewed";
};

type ThemePreference = "system" | "dark" | "light";
type StalePreference = "stale" | "active";
type SectionKey = "needsAttention" | "yourPrs" | "relatedToYou" | "stalePrs";
type SortPreference = "default" | "oldest-first" | "newest-first";

const SEARCH_PAGE_SIZE = 100;
const SEARCH_MAX_PAGES = 10;
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const FALLBACK_REFRESH_MS = 10 * 60 * 1000;
const NOTIFICATION_FALLBACK_MS = 2 * 60 * 1000;
const REFRESH_FOCUS_COOLDOWN_MS = 5 * 60 * 1000;

const MERGED_COUNT_DEFAULT = 5;
const MERGED_COUNT_MIN = 1;
const MERGED_COUNT_MAX = 25;

const STORAGE_KEYS: Record<
  | "token"
  | "org"
  | "viewed"
  | "theme"
  | "compact"
  | "stalePreferences"
  | "sectionSort"
  | "recentlyMergedCount"
  | "sectionHideDrafts"
  | "dimViewed",
  string
> = {
  token: "review-radar.pat",
  org: "review-radar.org",
  viewed: "review-radar.viewed",
  theme: "review-radar.theme",
  compact: "review-radar.compact",
  stalePreferences: "review-radar.stalePreferences",
  sectionSort: "review-radar.sectionSort",
  recentlyMergedCount: "review-radar.recentlyMergedCount",
  sectionHideDrafts: "review-radar.sectionHideDrafts",
  dimViewed: "review-radar.dimViewed",
};

function readStorageItem(key: string): string {
  if (typeof window === "undefined") {
    return "";
  }

  return localStorage.getItem(key) ?? "";
}

function readViewedMap(): Record<string, number> {
  const raw = readStorageItem(STORAGE_KEYS.viewed);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw) as Record<string, number>;
  } catch {
    return {};
  }
}

function readThemePreference(): ThemePreference {
  const value = readStorageItem(STORAGE_KEYS.theme);
  if (value === "dark" || value === "light" || value === "system") {
    return value;
  }

  return "system";
}

function readCompactPreference(): boolean {
  return readStorageItem(STORAGE_KEYS.compact) === "true";
}

function readStalePreferences(): Record<string, StalePreference> {
  const raw = readStorageItem(STORAGE_KEYS.stalePreferences);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const next: Record<string, StalePreference> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (value === "stale" || value === "active") {
        next[key] = value;
      }
    }
    return next;
  } catch {
    return {};
  }
}

const DEFAULT_SECTION_SORT: Record<SectionKey, SortPreference> = {
  needsAttention: "default",
  yourPrs: "default",
  relatedToYou: "default",
  stalePrs: "default",
};

function readMergedCountPreference(): number {
  const raw = readStorageItem(STORAGE_KEYS.recentlyMergedCount);
  if (!raw) {
    return MERGED_COUNT_DEFAULT;
  }

  const parsed = parseInt(raw, 10);
  if (isNaN(parsed) || parsed < MERGED_COUNT_MIN || parsed > MERGED_COUNT_MAX) {
    return MERGED_COUNT_DEFAULT;
  }

  return parsed;
}

function readSectionSortPreferences(): Record<SectionKey, SortPreference> {
  const raw = readStorageItem(STORAGE_KEYS.sectionSort);
  if (!raw) {
    return { ...DEFAULT_SECTION_SORT };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, string>;
    const result = { ...DEFAULT_SECTION_SORT };
    for (const key of Object.keys(result) as SectionKey[]) {
      const val = parsed[key];
      if (val === "oldest-first" || val === "newest-first") {
        result[key] = val;
      }
    }
    return result;
  } catch {
    return { ...DEFAULT_SECTION_SORT };
  }
}

function applySectionSort(
  prs: PullRequest[],
  preference: SortPreference,
): PullRequest[] {
  if (preference === "oldest-first") {
    return sortByCreatedAt(prs, "asc");
  }
  if (preference === "newest-first") {
    return sortByCreatedAt(prs, "desc");
  }
  return prs;
}

const DEFAULT_SECTION_HIDE_DRAFTS: Record<SectionKey, boolean> = {
  needsAttention: false,
  yourPrs: false,
  relatedToYou: false,
  stalePrs: false,
};

function readSectionHideDrafts(): Record<SectionKey, boolean> {
  const raw = readStorageItem(STORAGE_KEYS.sectionHideDrafts);
  if (!raw) {
    return { ...DEFAULT_SECTION_HIDE_DRAFTS };
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const result = { ...DEFAULT_SECTION_HIDE_DRAFTS };
    for (const key of Object.keys(result) as SectionKey[]) {
      if (parsed[key] === true) {
        result[key] = true;
      }
    }
    return result;
  } catch {
    return { ...DEFAULT_SECTION_HIDE_DRAFTS };
  }
}

function readDimViewedPreference(): boolean {
  const raw = readStorageItem(STORAGE_KEYS.dimViewed);
  if (raw === "false") return false;
  return true;
}

function applyDraftFilter(
  pullRequests: PullRequest[],
  hideDrafts: boolean,
): PullRequest[] {
  if (!hideDrafts) {
    return pullRequests;
  }
  return pullRequests.filter((pullRequest) => !pullRequest.isDraft);
}

function formatRefreshAge(timestampMs: number, nowMs: number): string {
  const diffSeconds = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));

  if (diffSeconds < 5) {
    return "just now";
  }

  if (diffSeconds < 60) {
    return `${diffSeconds}s ago`;
  }

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  }

  const diffHours = Math.floor(diffMinutes / 60);
  return `${diffHours}h ago`;
}

function sortByPriorityAndUpdated(
  prs: PullRequest[],
  priority: Record<string, number>,
): PullRequest[] {
  return [...prs].sort((a, b) => {
    const priorityDiff =
      (priority[a.stateClass] ?? 99) - (priority[b.stateClass] ?? 99);
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    return (
      new Date(b.updatedAtIso).getTime() - new Date(a.updatedAtIso).getTime()
    );
  });
}

async function fetchAndClassifyPullRequests(
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
        apiFetch<PullDetails>(pullUrl, token, etagCache),
        apiFetch<Review[]>(`${pullUrl}/reviews?per_page=100`, token, etagCache),
        apiFetch<PullComment[]>(
          `${pullUrl}/comments?per_page=100`,
          token,
          etagCache,
        ),
      ]);

      let checkState: PullRequest["checkState"] = "pending";
      let policyBotStatus: PolicyBotStatus | undefined;

      try {
        const combinedStatus = await apiFetch<CombinedStatusResponse>(
          `https://api.github.com/repos/${pull.base.repo.full_name}/commits/${pull.head.sha}/status`,
          token,
          etagCache,
        );

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
  const nowMs = Date.now()

  for (const { pull, reviews, pullComments, checkState, policyBotStatus } of pullsWithReviews) {
    const viewKey = prViewKey(pull.base.repo.full_name, pull.number)

    if (pull.state !== 'open' || pull.merged_at !== null) {
      if (viewedMap[viewKey] !== undefined) {
        closedViewedKeys.push(viewKey)
      }
      continue
    }

    const viewedAtMs = viewedMap[viewKey]
    const normalizedLogin = me.login.toLowerCase()

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
  }
}

async function fetchRecentlyMergedPRs(
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

function SectionHeader({
  title,
  sectionKey,
  count,
  updatedCount,
  statusLabel,
  openSectionMenuKey,
  sortPreference,
  isOpen,
  onToggleOpen,
  hideDrafts,
  onToggleHideDrafts,
  onToggleSectionMenu,
  onSetSort,
}: {
  title: string;
  sectionKey: SectionKey;
  count: number;
  updatedCount?: number;
  statusLabel?: string;
  openSectionMenuKey: SectionKey | null;
  sortPreference: SortPreference;
  isOpen: boolean;
  onToggleOpen: () => void;
  hideDrafts: boolean;
  onToggleHideDrafts: () => void;
  onToggleSectionMenu: (key: SectionKey) => void;
  onSetSort: (key: SectionKey, sort: SortPreference) => void;
}) {
  const isMenuOpen = openSectionMenuKey === sectionKey;

  return (
    <div className="section-header">
      <button
        type="button"
        className="section-title-toggle"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
      >
        <svg
          className={`section-chevron${isOpen ? "" : " section-chevron--collapsed"}`}
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
          role="presentation"
        >
          <path
            d="M4.5 6L8 9.5 11.5 6"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="section-title-text">{title}</span>
      </button>
      <div className="section-header-tools">
        <span>
          {count}
          {updatedCount != null && updatedCount > 0 ? (
            <span className="section-count-detail">
              {" "}
              · {updatedCount} updated
            </span>
          ) : null}
        </span>
        {statusLabel ? (
          <span className="section-status-label">{statusLabel}</span>
        ) : null}
        <span className="section-count-detail"> · </span>
        <label className="draft-toggle" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            className="draft-toggle-input"
            checked={!hideDrafts}
            onChange={() => onToggleHideDrafts()}
          />
          <span className="draft-toggle-track">
            <span className="draft-toggle-knob" />
          </span>
          Show drafts
        </label>
        <span className="section-count-detail"> · </span>
        <div className="section-menu-wrap">
          <button
            type="button"
            className="section-menu-toggle"
            aria-label="Sort options"
            aria-expanded={isMenuOpen}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSectionMenu(sectionKey);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
              <path d="M8 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0 6.5A1.5 1.5 0 1 1 8 6.5a1.5 1.5 0 0 1 0 3Zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
            </svg>
          </button>
          {isMenuOpen ? (
            <div
              className="section-menu"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="row-menu-hint">Sort By</span>
              <button
                type="button"
                className={`row-menu-item${sortPreference === "oldest-first" ? " active-sort" : ""}`}
                onClick={() => onSetSort(sectionKey, "oldest-first")}
              >
                {sortPreference === "oldest-first" ? "\u2713 " : ""}Oldest first
              </button>
              <button
                type="button"
                className={`row-menu-item${sortPreference === "newest-first" ? " active-sort" : ""}`}
                onClick={() => onSetSort(sectionKey, "newest-first")}
              >
                {sortPreference === "newest-first" ? "\u2713 " : ""}Newest first
              </button>
              <button
                type="button"
                className={`row-menu-item${sortPreference === "default" ? " active-sort" : ""}`}
                onClick={() => onSetSort(sectionKey, "default")}
              >
                {sortPreference === "default" ? "\u2713 " : ""}Last updated
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function PullRequestRow({
  pr,
  isViewed,
  onViewed,
  stalePreference,
  sectionKind,
  openMenuKey,
  onToggleMenu,
  onCloseMenu,
  onMarkStale,
  onMarkActive,
  onClearStalePreference,
}: {
  pr: PullRequest;
  isViewed: boolean;
  onViewed: (repository: string, number: number) => void;
  stalePreference?: StalePreference;
  sectionKind: "active" | "stale";
  openMenuKey: string | null;
  onToggleMenu: (menuKey: string) => void;
  onCloseMenu: () => void;
  onMarkStale: (repository: string, number: number) => void;
  onMarkActive: (repository: string, number: number) => void;
  onClearStalePreference: (repository: string, number: number) => void;
}) {
  const checkTitle =
    pr.checkState === "success"
      ? "Checks passed"
      : pr.checkState === "failure"
        ? "Checks failing"
        : "Checks pending";

  const policyTitle = pr.policyBotStatus
    ? pr.policyBotStatus.state === "success"
      ? "Policy: approved"
      : pr.policyBotStatus.state === "failure"
        ? "Policy: not satisfied"
        : "Policy: pending"
    : undefined;

  const menuKey = prViewKey(pr.repository, pr.number);
  const isMenuOpen = openMenuKey === menuKey;

  function handleViewed(): void {
    onViewed(pr.repository, pr.number);
  }

  return (
    <article className={`pr-row${isViewed ? " viewed" : ""}`}>
      <div className="title-group">
        <a
          href={pr.authorProfileUrl}
          className="avatar-link"
          target="_blank"
          rel="noreferrer"
          title={pr.author}
          aria-label={`Open ${pr.author} profile`}
        >
          <img
            src={pr.authorAvatarUrl}
            className="avatar"
            alt={`${pr.author} avatar`}
          />
        </a>
        <div>
          <div className="pr-title-line">
            <span
              className={`check-indicator ${pr.checkState}`}
              title={checkTitle}
              aria-label={checkTitle}
            >
              {pr.checkState === "success" ? (
                <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                  <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06l2.47 2.47 5.97-5.97a.75.75 0 0 1 1.06 0Z" />
                </svg>
              ) : pr.checkState === "failure" ? (
                <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                  <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                  <circle cx="8" cy="8" r="3.5" />
                </svg>
              )}
            </span>
            <a
              href={pr.url}
              className="pr-title"
              target="_blank"
              rel="noreferrer"
              onClick={handleViewed}
            >
              {pr.isDraft ? "[Draft] " : ""}
              {pr.title}
            </a>
          </div>
          <p className="pr-meta">
            #{pr.number} opened by{" "}
            <a
              href={pr.authorProfileUrl}
              className="meta-link"
              target="_blank"
              rel="noreferrer"
            >
              {pr.author}
            </a>{" "}
            in{" "}
            <a
              href={pr.repositoryUrl}
              className="meta-link"
              target="_blank"
              rel="noreferrer"
            >
              {pr.repository}
            </a>
          </p>
          {pr.requestedReviewers.length > 0 ? (
            <div className="reviewer-list" aria-label="Requested reviewers">
              {pr.requestedReviewers.map((reviewer) => (
                <a
                  key={reviewer.login}
                  href={reviewer.profileUrl}
                  className="avatar-link reviewer-avatar-link"
                  target="_blank"
                  rel="noreferrer"
                  title={reviewer.login}
                  aria-label={`Open ${reviewer.login} profile`}
                >
                  <img
                    src={reviewer.avatarUrl}
                    className="avatar reviewer-avatar"
                    alt={`${reviewer.login} avatar`}
                  />
                </a>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="status-group">
        <div className="status-row">
          {pr.policyBotStatus ? (
            <a
              href={pr.policyBotStatus.url ?? undefined}
              className={`policy-indicator ${pr.policyBotStatus.state}`}
              title={policyTitle}
              aria-label={policyTitle}
              target="_blank"
              rel="noreferrer"
            >
              <span className="sr-only">{policyTitle}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                <path d="M8 0L1 3v4.5c0 3.88 2.98 7.5 7 8.5 4.02-1 7-4.62 7-8.5V3L8 0Zm0 1.33 5.5 2.36v3.81c0 3.22-2.42 6.25-5.5 7.17-3.08-.92-5.5-3.95-5.5-7.17V3.69L8 1.33Z" />
              </svg>
            </a>
          ) : null}
          {pr.stateLabel ? (
            <span className="pill-wrap">
              <span className={`pill ${pr.stateClass}`}>{pr.stateLabel}</span>
              <span className="pill-tooltip" role="tooltip">
                {pr.reason}
              </span>
            </span>
          ) : null}
        </div>
        <span className="updated-at">{pr.updatedAt}</span>
      </div>
      <div className="row-menu-wrap">
        <button
          type="button"
          className="row-menu-toggle"
          aria-label="Open row actions"
          aria-expanded={isMenuOpen}
          onClick={(event) => {
            event.stopPropagation();
            onToggleMenu(menuKey);
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
            <path d="M8 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0 6.5A1.5 1.5 0 1 1 8 6.5a1.5 1.5 0 0 1 0 3Zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
          </svg>
        </button>

        {isMenuOpen ? (
          <div
            className="row-menu"
            onClick={(event) => event.stopPropagation()}
          >
            {sectionKind === "stale" ? (
              <>
                <span className="row-menu-hint">
                  {pr.staleState === "manual"
                    ? "Manually stale"
                    : "Auto stale (30d+)"}
                </span>
                <button
                  type="button"
                  className="row-menu-item"
                  onClick={() => {
                    onMarkActive(pr.repository, pr.number);
                    onCloseMenu();
                  }}
                >
                  Not stale
                </button>
              </>
            ) : stalePreference === "active" ? (
              <button
                type="button"
                className="row-menu-item"
                onClick={() => {
                  onClearStalePreference(pr.repository, pr.number);
                  onCloseMenu();
                }}
              >
                Use auto rule
              </button>
            ) : (
              <button
                type="button"
                className="row-menu-item danger-item"
                onClick={() => {
                  onMarkStale(pr.repository, pr.number);
                  onCloseMenu();
                }}
              >
                Mark stale
              </button>
            )}
            <a
              href={pr.url}
              className="row-menu-item"
              target="_blank"
              rel="noreferrer"
              onClick={() => onCloseMenu()}
            >
              Open PR
            </a>
            <a
              href={pr.repositoryUrl}
              className="row-menu-item"
              target="_blank"
              rel="noreferrer"
              onClick={() => onCloseMenu()}
            >
              Open repo
            </a>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function MergedPrRow({ pr }: { pr: MergedPullRequest }) {
  return (
    <article className="pr-row">
      <div className="title-group">
        <a
          href={pr.authorProfileUrl}
          className="avatar-link"
          target="_blank"
          rel="noreferrer"
          title={pr.author}
          aria-label={`Open ${pr.author} profile`}
        >
          <img
            src={pr.authorAvatarUrl}
            className="avatar"
            alt={`${pr.author} avatar`}
          />
        </a>
        <div>
          <div className="pr-title-line">
            <span className="check-indicator success">
              <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.28 6.72a.75.75 0 0 0-1.06 1.06l2.5 2.5a.75.75 0 0 0 1.06 0l4-4Z" />
              </svg>
            </span>
            <a
              href={pr.url}
              className="pr-title"
              target="_blank"
              rel="noreferrer"
            >
              {pr.title}
            </a>
          </div>
          <p className="pr-meta">
            #{pr.number} by{" "}
            <a
              href={pr.authorProfileUrl}
              className="meta-link"
              target="_blank"
              rel="noreferrer"
            >
              {pr.author}
            </a>{" "}
            in{" "}
            <a
              href={pr.repositoryUrl}
              className="meta-link"
              target="_blank"
              rel="noreferrer"
            >
              {pr.repository}
            </a>
          </p>
        </div>
      </div>
      <div className="status-group">
        <span className="pill-wrap">
          <span
            className={`pill merged-pill ${pr.role === "author" ? "merged-author" : "merged-reviewed"}`}
          >
            {pr.role === "author" ? "Author" : "Reviewed"}
          </span>
        </span>
        <span className="updated-at">Merged {pr.mergedAt}</span>
      </div>
    </article>
  );
}

function App() {
  const [tokenInput, setTokenInput] = useState(() =>
    readStorageItem(STORAGE_KEYS.token),
  );
  const [token, setToken] = useState(() => readStorageItem(STORAGE_KEYS.token));
  const [orgInput, setOrgInput] = useState(
    () => readStorageItem(STORAGE_KEYS.org) || "MaintainX",
  );
  const [org, setOrg] = useState(() => readStorageItem(STORAGE_KEYS.org));
  const [viewedMap, setViewedMap] = useState<Record<string, number>>(() =>
    readViewedMap(),
  );
  const [stalePreferences, setStalePreferences] = useState<
    Record<string, StalePreference>
  >(() => readStalePreferences());
  const [isLoading, setIsLoading] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [rateLimitWarning, setRateLimitWarning] = useState(false);
  const [teamSignalsUnavailable, setTeamSignalsUnavailable] = useState<
    string | null
  >(null);
  const [stalePrs, setStalePrs] = useState<PullRequest[]>([]);
  const [yourPrs, setYourPrs] = useState<PullRequest[]>([]);
  const [needsAttention, setNeedsAttention] = useState<PullRequest[]>([]);
  const [relatedToYou, setRelatedToYou] = useState<PullRequest[]>([]);
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  );
  const [isCompact, setIsCompact] = useState(() => readCompactPreference());
  const [dimViewed, setDimViewed] = useState(() => readDimViewedPreference());
  const [isConnectionPanelOpen, setIsConnectionPanelOpen] = useState(() => {
    const savedToken = readStorageItem(STORAGE_KEYS.token);
    const savedOrg = readStorageItem(STORAGE_KEYS.org);
    return !(savedToken && savedOrg);
  });
  const [recentlyMerged, setRecentlyMerged] = useState<MergedPullRequest[]>([]);
  const [isRecentlyMergedOpen, setIsRecentlyMergedOpen] = useState(false);
  const [mergedCount, setMergedCount] = useState(() =>
    readMergedCountPreference(),
  );
  const [mergedCountInput, setMergedCountInput] = useState(() =>
    String(readMergedCountPreference()),
  );
  const [isStaleSectionOpen, setIsStaleSectionOpen] = useState(false);
  const [isNeedsAttentionOpen, setIsNeedsAttentionOpen] = useState(true);
  const [isYourPrsOpen, setIsYourPrsOpen] = useState(true);
  const [isRelatedToYouOpen, setIsRelatedToYouOpen] = useState(true);
  const [openRowMenuKey, setOpenRowMenuKey] = useState<string | null>(null);
  const [openSectionMenuKey, setOpenSectionMenuKey] =
    useState<SectionKey | null>(null);
  const [sectionSortPreferences, setSectionSortPreferences] = useState<
    Record<SectionKey, SortPreference>
  >(readSectionSortPreferences);
  const [sectionHideDrafts, setSectionHideDrafts] = useState<
    Record<SectionKey, boolean>
  >(readSectionHideDrafts);
  const [refreshTick, setRefreshTick] = useState(0);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const isLoadingRef = useRef(false);
  const viewedMapRef = useRef<Record<string, number>>(viewedMap);
  const lastVisibilityRefreshAtRef = useRef(0);

  function resolveTheme(preference: ThemePreference): "dark" | "light" {
    if (preference === "dark") {
      return "dark";
    }

    if (preference === "light") {
      return "light";
    }

    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");

    function applyTheme(): void {
      document.documentElement.dataset.theme = resolveTheme(themePreference);
    }

    applyTheme();

    if (themePreference !== "system") {
      return;
    }

    mediaQuery.addEventListener("change", applyTheme);
    return () => {
      mediaQuery.removeEventListener("change", applyTheme);
    };
  }, [themePreference]);

  useEffect(() => {
    document.documentElement.dataset.compact = String(isCompact);
  }, [isCompact]);

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    viewedMapRef.current = viewedMap;
  }, [viewedMap]);

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30 * 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    if (!isConnectionPanelOpen) {
      return;
    }

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setIsConnectionPanelOpen(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isConnectionPanelOpen]);

  useEffect(() => {
    if (!token || !org) {
      return;
    }

    const controller = new SmartRefreshController({
      token,
      org,
      onRefresh: () => {
        if (document.visibilityState !== "visible" || isLoadingRef.current) {
          return;
        }

        setRefreshTick((current) => current + 1);
      },
      fallbackIntervalMs: FALLBACK_REFRESH_MS,
      degradedIntervalMs: NOTIFICATION_FALLBACK_MS,
    });

    controller.start();

    return () => {
      controller.stop();
    };
  }, [org, token]);

  useEffect(() => {
    if (!token || !org) {
      return;
    }

    function triggerFocusRefresh(): void {
      if (document.visibilityState !== "visible" || isLoadingRef.current) {
        return;
      }

      const now = Date.now();
      if (
        now - lastVisibilityRefreshAtRef.current <
        REFRESH_FOCUS_COOLDOWN_MS
      ) {
        return;
      }

      lastVisibilityRefreshAtRef.current = now;
      setRefreshTick((current) => current + 1);
    }

    function handleVisibilityChange(): void {
      if (document.visibilityState === "visible") {
        triggerFocusRefresh();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", triggerFocusRefresh);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", triggerFocusRefresh);
    };
  }, [org, token]);

  useEffect(() => {
    function handleGlobalClick(event: MouseEvent): void {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      if (!target.closest(".row-menu") && !target.closest(".row-menu-toggle")) {
        setOpenRowMenuKey(null);
      }

      if (
        !target.closest(".section-menu") &&
        !target.closest(".section-menu-toggle")
      ) {
        setOpenSectionMenuKey(null);
      }
    }

    function handleEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpenRowMenuKey(null);
        setOpenSectionMenuKey(null);
      }
    }

    document.addEventListener("click", handleGlobalClick);
    window.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("click", handleGlobalClick);
      window.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!token || !org) {
      setIsConnectionPanelOpen(true);
    }
  }, [org, token]);

  useEffect(() => {
    if (!token || !org) {
      setStalePrs([]);
      setYourPrs([]);
      setNeedsAttention([]);
      setRelatedToYou([]);
      setRecentlyMerged([]);
      setTeamSignalsUnavailable(null);
      return;
    }

    let ignore = false;

    async function loadAndClassifyPulls(): Promise<void> {
      setIsLoading(true);
      setErrorToast(null);

      try {
        const [classified, merged] = await Promise.all([
          fetchAndClassifyPullRequests(
            org,
            token,
            viewedMapRef.current,
            stalePreferences,
          ),
          fetchRecentlyMergedPRs(org, token, mergedCount),
        ]);
        if (!ignore) {
          setStalePrs(classified.stalePrs);
          setYourPrs(classified.yourPrs);
          setNeedsAttention(classified.needsAttention);
          setRelatedToYou(classified.relatedToYou);
          setTeamSignalsUnavailable(classified.teamSignalsUnavailable);
          setRecentlyMerged(merged);
          setLastRefreshedAt(Date.now());
          setRateLimitWarning(false);

          if (classified.closedViewedKeys.length > 0) {
            setViewedMap((current) => {
              const next = { ...current }
              for (const key of classified.closedViewedKeys) {
                delete next[key]
              }
              localStorage.setItem(STORAGE_KEYS.viewed, JSON.stringify(next))
              return next
            })
          }
        }
      } catch (loadError) {
        if (!ignore) {
          if (loadError instanceof RateLimitError) {
            setRateLimitWarning(true);
          } else {
            const message =
              loadError instanceof Error
                ? loadError.message
                : "Failed to load pull requests.";
            setErrorToast(message);
          }
        }
      } finally {
        if (!ignore) {
          setIsLoading(false);
        }
      }
    }

    void loadAndClassifyPulls();

    return () => {
      ignore = true;
    };
  }, [mergedCount, org, refreshTick, stalePreferences, token]);

  function handleSaveConfig(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextToken = tokenInput.trim();
    const nextOrg = orgInput.trim();
    localStorage.setItem(STORAGE_KEYS.token, nextToken);
    localStorage.setItem(STORAGE_KEYS.org, nextOrg);
    setToken(nextToken);
    setOrg(nextOrg);
    setIsConnectionPanelOpen(false);
  }

  function handleViewed(repository: string, number: number): void {
    const key = prViewKey(repository, number);
    const now = Date.now();
    setViewedMap((current) => {
      const next = { ...current, [key]: now };
      localStorage.setItem(STORAGE_KEYS.viewed, JSON.stringify(next));
      return next;
    });
  }

  function updateStalePreference(
    repository: string,
    number: number,
    nextValue?: StalePreference,
  ): void {
    const key = prViewKey(repository, number);

    setStalePreferences((current) => {
      const next = { ...current };
      if (nextValue) {
        next[key] = nextValue;
      } else {
        delete next[key];
      }

      localStorage.setItem(STORAGE_KEYS.stalePreferences, JSON.stringify(next));
      return next;
    });
  }

  function handleMarkStale(repository: string, number: number): void {
    updateStalePreference(repository, number, "stale");
  }

  function handleMarkActive(repository: string, number: number): void {
    updateStalePreference(repository, number, "active");
  }

  function handleClearStalePreference(
    repository: string,
    number: number,
  ): void {
    updateStalePreference(repository, number);
  }

  function handleToggleRowMenu(menuKey: string): void {
    setOpenRowMenuKey((current) => (current === menuKey ? null : menuKey));
  }

  function handleCloseRowMenu(): void {
    setOpenRowMenuKey(null);
  }

  function handleToggleSectionMenu(sectionKey: SectionKey): void {
    setOpenSectionMenuKey((current) =>
      current === sectionKey ? null : sectionKey,
    );
  }

  function handleSetSectionSort(
    sectionKey: SectionKey,
    sort: SortPreference,
  ): void {
    setSectionSortPreferences((current) => {
      const next = { ...current, [sectionKey]: sort };
      localStorage.setItem(STORAGE_KEYS.sectionSort, JSON.stringify(next));
      return next;
    });
    setOpenSectionMenuKey(null);
  }

  function handleToggleSectionHideDrafts(sectionKey: SectionKey): void {
    setSectionHideDrafts((current) => {
      const next = { ...current, [sectionKey]: !current[sectionKey] };
      localStorage.setItem(
        STORAGE_KEYS.sectionHideDrafts,
        JSON.stringify(next),
      );
      return next;
    });
  }

  function toggleTheme(): void {
    const activeTheme = resolveTheme(themePreference);
    const nextPreference: ThemePreference =
      activeTheme === "dark" ? "light" : "dark";
    setThemePreference(nextPreference);
    localStorage.setItem(STORAGE_KEYS.theme, nextPreference);
  }

  function toggleCompact(): void {
    setIsCompact((current) => {
      const next = !current;
      localStorage.setItem(STORAGE_KEYS.compact, String(next));
      return next;
    });
  }

  function toggleDimViewed(): void {
    setDimViewed((current) => {
      const next = !current;
      localStorage.setItem(STORAGE_KEYS.dimViewed, String(next));
      return next;
    });
  }

  function handleMergedCountChange(rawValue: string): void {
    setMergedCountInput(rawValue);
    const parsed = parseInt(rawValue, 10);
    if (
      !isNaN(parsed) &&
      parsed >= MERGED_COUNT_MIN &&
      parsed <= MERGED_COUNT_MAX
    ) {
      setMergedCount(parsed);
      localStorage.setItem(STORAGE_KEYS.recentlyMergedCount, String(parsed));
    }
  }

  const activeTheme = resolveTheme(themePreference);
  const hasSavedConnection = Boolean(token && org);
  const displayNeedsAttention = applyDraftFilter(
    applySectionSort(needsAttention, sectionSortPreferences.needsAttention),
    sectionHideDrafts.needsAttention,
  );
  const displayYourPrs = applyDraftFilter(
    applySectionSort(yourPrs, sectionSortPreferences.yourPrs),
    sectionHideDrafts.yourPrs,
  );
  const displayRelatedToYou = applyDraftFilter(
    applySectionSort(relatedToYou, sectionSortPreferences.relatedToYou),
    sectionHideDrafts.relatedToYou,
  );

  const needsAttentionUpdatedCount = displayNeedsAttention.filter(
    (pr) => pr.stateLabel,
  ).length;
  const yourPrsUpdatedCount = displayYourPrs.filter(
    (pr) => pr.stateLabel,
  ).length;
  const relatedToYouUpdatedCount = displayRelatedToYou.filter(
    (pr) => pr.stateLabel,
  ).length;
  const displayStalePrs = applyDraftFilter(
    applySectionSort(stalePrs, sectionSortPreferences.stalePrs),
    sectionHideDrafts.stalePrs,
  );

  const refreshLabel = isLoading
    ? "Refreshing..."
    : lastRefreshedAt
      ? `Last updated ${formatRefreshAge(lastRefreshedAt, nowMs)}`
      : "Not refreshed yet";

  return (
    <main className="app-shell">
      <button
        type="button"
        className="settings-toggle"
        aria-label="Open settings"
        onClick={() => setIsConnectionPanelOpen(true)}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" role="presentation">
          <path d="M4 6.5a1 1 0 1 1 0-2h16a1 1 0 1 1 0 2H4Zm0 7a1 1 0 1 1 0-2h16a1 1 0 1 1 0 2H4Zm0 7a1 1 0 1 1 0-2h16a1 1 0 1 1 0 2H4Z" />
        </svg>
      </button>

      <header className="page-header">
        <h1>Review Radar</h1>
        <p className="refresh-meta">{refreshLabel}</p>
      </header>

      <section className="section-card">
        <SectionHeader
          title="Needs your attention"
          sectionKey="needsAttention"
          count={displayNeedsAttention.length}
          updatedCount={needsAttentionUpdatedCount}
          statusLabel={
            isLoading && !lastRefreshedAt ? "Classifying..." : undefined
          }
          openSectionMenuKey={openSectionMenuKey}
          sortPreference={sectionSortPreferences.needsAttention}
          isOpen={isNeedsAttentionOpen}
          onToggleOpen={() => setIsNeedsAttentionOpen((current) => !current)}
          hideDrafts={sectionHideDrafts.needsAttention}
          onToggleHideDrafts={() =>
            handleToggleSectionHideDrafts("needsAttention")
          }
          onToggleSectionMenu={handleToggleSectionMenu}
          onSetSort={handleSetSectionSort}
        />
        {isNeedsAttentionOpen ? (
          <div>
            {!isLoading &&
            token &&
            org &&
            displayNeedsAttention.length === 0 ? (
              <p className="empty-state">
                Nothing currently needs your immediate attention.
              </p>
            ) : null}
            {!isLoading && (!token || !org) ? (
              <p className="empty-state">
                Add org + PAT above to classify pull requests.
              </p>
            ) : null}
            {displayNeedsAttention.map((pr) => (
              <PullRequestRow
                key={pr.id}
                pr={pr}
                isViewed={
                  dimViewed &&
                  Boolean(viewedMap[prViewKey(pr.repository, pr.number)])
                }
                onViewed={handleViewed}
                sectionKind="active"
                openMenuKey={openRowMenuKey}
                onToggleMenu={handleToggleRowMenu}
                onCloseMenu={handleCloseRowMenu}
                stalePreference={
                  stalePreferences[prViewKey(pr.repository, pr.number)]
                }
                onMarkStale={handleMarkStale}
                onMarkActive={handleMarkActive}
                onClearStalePreference={handleClearStalePreference}
              />
            ))}
          </div>
        ) : (
          <p className="collapsed-hint">
            Section collapsed — click the title to expand.
          </p>
        )}
      </section>

      <section className="section-card">
        <SectionHeader
          title="Your PRs"
          sectionKey="yourPrs"
          count={displayYourPrs.length}
          updatedCount={yourPrsUpdatedCount}
          statusLabel={isLoading && !lastRefreshedAt ? "Loading..." : undefined}
          openSectionMenuKey={openSectionMenuKey}
          sortPreference={sectionSortPreferences.yourPrs}
          isOpen={isYourPrsOpen}
          onToggleOpen={() => setIsYourPrsOpen((current) => !current)}
          hideDrafts={sectionHideDrafts.yourPrs}
          onToggleHideDrafts={() => handleToggleSectionHideDrafts("yourPrs")}
          onToggleSectionMenu={handleToggleSectionMenu}
          onSetSort={handleSetSectionSort}
        />
        {isYourPrsOpen ? (
          <div>
            {!isLoading && token && org && displayYourPrs.length === 0 ? (
              <p className="empty-state">
                No assigned or authored pull requests right now.
              </p>
            ) : null}
            {!isLoading && (!token || !org) ? (
              <p className="empty-state">
                Add org + PAT above to load pull requests from GitHub.
              </p>
            ) : null}
            {displayYourPrs.map((pr) => (
              <PullRequestRow
                key={pr.id}
                pr={pr}
                isViewed={
                  dimViewed &&
                  Boolean(viewedMap[prViewKey(pr.repository, pr.number)])
                }
                onViewed={handleViewed}
                sectionKind="active"
                openMenuKey={openRowMenuKey}
                onToggleMenu={handleToggleRowMenu}
                onCloseMenu={handleCloseRowMenu}
                stalePreference={
                  stalePreferences[prViewKey(pr.repository, pr.number)]
                }
                onMarkStale={handleMarkStale}
                onMarkActive={handleMarkActive}
                onClearStalePreference={handleClearStalePreference}
              />
            ))}
          </div>
        ) : (
          <p className="collapsed-hint">
            Section collapsed — click the title to expand.
          </p>
        )}
      </section>

      <section className="section-card">
        <SectionHeader
          title="Related to you"
          sectionKey="relatedToYou"
          count={displayRelatedToYou.length}
          updatedCount={relatedToYouUpdatedCount}
          statusLabel={isLoading && !lastRefreshedAt ? "Loading..." : undefined}
          openSectionMenuKey={openSectionMenuKey}
          sortPreference={sectionSortPreferences.relatedToYou}
          isOpen={isRelatedToYouOpen}
          onToggleOpen={() => setIsRelatedToYouOpen((current) => !current)}
          hideDrafts={sectionHideDrafts.relatedToYou}
          onToggleHideDrafts={() =>
            handleToggleSectionHideDrafts("relatedToYou")
          }
          onToggleSectionMenu={handleToggleSectionMenu}
          onSetSort={handleSetSectionSort}
        />
        {isRelatedToYouOpen ? (
          <div>
            {!isLoading && token && org && displayRelatedToYou.length === 0 ? (
              <p className="empty-state">
                No non-urgent related pull requests right now.
              </p>
            ) : null}
            {!isLoading && (!token || !org) ? (
              <p className="empty-state">
                Add org + PAT above to load pull requests from GitHub.
              </p>
            ) : null}
            {displayRelatedToYou.map((pr) => (
              <PullRequestRow
                key={pr.id}
                pr={pr}
                isViewed={
                  dimViewed &&
                  Boolean(viewedMap[prViewKey(pr.repository, pr.number)])
                }
                onViewed={handleViewed}
                sectionKind="active"
                openMenuKey={openRowMenuKey}
                onToggleMenu={handleToggleRowMenu}
                onCloseMenu={handleCloseRowMenu}
                stalePreference={
                  stalePreferences[prViewKey(pr.repository, pr.number)]
                }
                onMarkStale={handleMarkStale}
                onMarkActive={handleMarkActive}
                onClearStalePreference={handleClearStalePreference}
              />
            ))}
          </div>
        ) : (
          <p className="collapsed-hint">
            Section collapsed — click the title to expand.
          </p>
        )}
      </section>

      <section className="section-card">
        <div className="section-header">
          <button
            type="button"
            className="section-title-toggle"
            onClick={() => setIsRecentlyMergedOpen((current) => !current)}
            aria-expanded={isRecentlyMergedOpen}
          >
            <svg
              className={`section-chevron${isRecentlyMergedOpen ? "" : " section-chevron--collapsed"}`}
              viewBox="0 0 16 16"
              width="14"
              height="14"
              aria-hidden="true"
              role="presentation"
            >
              <path d="M4.5 6L8 9.5 11.5 6" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="section-title-text">Recently merged</span>
          </button>
          <div className="section-header-tools">
            <span>{recentlyMerged.length}</span>
            {isLoading && !lastRefreshedAt ? (
              <span className="section-status-label">Loading...</span>
            ) : null}
          </div>
        </div>
        {isRecentlyMergedOpen ? (
          <div>
            {!isLoading && token && org && recentlyMerged.length === 0 ? (
              <p className="empty-state">
                No recently merged pull requests found.
              </p>
            ) : null}
            {!isLoading && (!token || !org) ? (
              <p className="empty-state">
                Add org + PAT above to load pull requests from GitHub.
              </p>
            ) : null}
            {recentlyMerged.map((pr) => (
              <MergedPrRow key={pr.id} pr={pr} />
            ))}
          </div>
        ) : (
          <p className="collapsed-hint">Section collapsed — click the title to expand.</p>
        )}
      </section>

      <section className="section-card">
        <SectionHeader
          title="Stale PRs"
          sectionKey="stalePrs"
          count={displayStalePrs.length}
          openSectionMenuKey={openSectionMenuKey}
          sortPreference={sectionSortPreferences.stalePrs}
          isOpen={isStaleSectionOpen}
          onToggleOpen={() => setIsStaleSectionOpen((current) => !current)}
          hideDrafts={sectionHideDrafts.stalePrs}
          onToggleHideDrafts={() => handleToggleSectionHideDrafts("stalePrs")}
          onToggleSectionMenu={handleToggleSectionMenu}
          onSetSort={handleSetSectionSort}
        />
        {isStaleSectionOpen ? (
          <div>
            {!isLoading && token && org && displayStalePrs.length === 0 ? (
              <p className="empty-state">No stale pull requests right now.</p>
            ) : null}
            {!isLoading && (!token || !org) ? (
              <p className="empty-state">
                Add org + PAT above to load pull requests from GitHub.
              </p>
            ) : null}
            {displayStalePrs.map((pr) => (
              <PullRequestRow
                key={pr.id}
                pr={pr}
                isViewed={
                  dimViewed &&
                  Boolean(viewedMap[prViewKey(pr.repository, pr.number)])
                }
                onViewed={handleViewed}
                sectionKind="stale"
                openMenuKey={openRowMenuKey}
                onToggleMenu={handleToggleRowMenu}
                onCloseMenu={handleCloseRowMenu}
                stalePreference={
                  stalePreferences[prViewKey(pr.repository, pr.number)]
                }
                onMarkStale={handleMarkStale}
                onMarkActive={handleMarkActive}
                onClearStalePreference={handleClearStalePreference}
              />
            ))}
          </div>
        ) : (
          <p className="collapsed-hint">
            Section collapsed — click the title to expand.
          </p>
        )}
      </section>

      {isConnectionPanelOpen ? (
        <>
          <button
            type="button"
            className="settings-backdrop"
            aria-label="Close settings"
            onClick={() => setIsConnectionPanelOpen(false)}
          />
          <aside className="settings-drawer" aria-label="Connection settings">
            <div className="settings-header">
              <h2>Settings</h2>
              <button
                type="button"
                className="settings-close"
                onClick={() => setIsConnectionPanelOpen(false)}
              >
                Close
              </button>
            </div>
            {hasSavedConnection ? (
              <p className="connection-summary">
                Connected to {org} with saved PAT.
              </p>
            ) : null}
            <form className="config-form" onSubmit={handleSaveConfig}>
              <label>
                GitHub organization
                <input
                  type="text"
                  value={orgInput}
                  onChange={(event) => setOrgInput(event.target.value)}
                  placeholder="your-org"
                  autoComplete="organization"
                />
              </label>
              <label>
                Personal access token
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(event) => setTokenInput(event.target.value)}
                  placeholder="github_pat_..."
                  autoComplete="off"
                />
              </label>
              <button type="submit">Save and refresh</button>
            </form>
            <div className="helper-copy">
              <p>PAT is stored in local storage for this browser profile.</p>
              <p>
                <a
                  href="https://github.com/settings/personal-access-tokens/new"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Create a fine-grained PAT
                </a>{" "}
                and set <strong>Resource owner</strong> to{" "}
                <strong>MaintainX</strong> (the Resource owner cannot be changed
                after creation — if your existing token uses your personal
                account, you need to generate a new one). Then select{" "}
                <strong>All repositories</strong> and grant these permissions:
              </p>
              <ul>
                <li>Pull requests: Read (required)</li>
                <li>
                  Commit statuses: Read (required for PR check status icons)
                </li>
                <li>
                  Members: Read — organization permission (optional, enables
                  team-assigned PR signals)
                </li>
              </ul>
              <p>
                For <strong>live refresh</strong> (~60s), use a{" "}
                <a
                  href="https://github.com/settings/tokens/new"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  classic token
                </a>{" "}
                with <strong>repo</strong> and <strong>notifications</strong>{" "}
                scopes, then authorize it for <strong>MaintainX SSO</strong>.
                Fine-grained tokens use 2-minute polling instead (still
                efficient via ETag caching).
              </p>
            </div>
            <div className="user-preferences">
              <h3 className="user-preferences-heading">User preferences</h3>
              <div className="user-preferences-group">
                <h4 className="user-preferences-subheading">
                  Recently merged count
                </h4>
                <p className="user-preferences-description">
                  Number of recently merged PRs to show.
                </p>
                <input
                  type="number"
                  className="user-preferences-number"
                  value={mergedCountInput}
                  onChange={(event) =>
                    handleMergedCountChange(event.target.value)
                  }
                  onBlur={() => setMergedCountInput(String(mergedCount))}
                  min={MERGED_COUNT_MIN}
                  max={MERGED_COUNT_MAX}
                  autoComplete="off"
                />
              </div>
              <div className="user-preferences-group">
                <h4 className="user-preferences-subheading">Dim viewed PRs</h4>
                <label className="user-preferences-toggle">
                  <span className="user-preferences-description">
                    Reduce opacity of PRs you have already clicked.
                  </span>
                  <input
                    type="checkbox"
                    checked={dimViewed}
                    onChange={toggleDimViewed}
                  />
                </label>
              </div>
            </div>
            {teamSignalsUnavailable ? (
              <p className="helper-copy warning-copy">
                {teamSignalsUnavailable} Showing direct-review and
                activity-based signals only.
              </p>
            ) : null}
          </aside>
        </>
      ) : null}

      <a
        href="https://github.com/maintainx-labs/ReviewRadar"
        className="github-fab"
        target="_blank"
        rel="noreferrer"
        aria-label="View source on GitHub"
      >
        <span className="fab-tooltip">Contribute on GitHub</span>
        <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
          <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
        </svg>
      </a>

      <button
        type="button"
        className="compact-fab"
        onClick={toggleCompact}
        aria-label={
          isCompact ? "Switch to comfortable view" : "Switch to compact view"
        }
      >
        <span className="fab-tooltip">
          {isCompact ? "Comfortable view" : "Compact view"}
        </span>
        {isCompact ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" role="presentation">
            <path d="M20.25 3a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V5.56l-3.97 3.97a.75.75 0 0 1-1.06-1.06l3.97-3.97h-2.69a.75.75 0 0 1 0-1.5h4.5Z" />
            <path d="M3.75 3a.75.75 0 0 0-.75.75v4.5a.75.75 0 0 0 1.5 0V5.56l3.97 3.97a.75.75 0 0 0 1.06-1.06L5.56 4.5h2.69a.75.75 0 0 0 0-1.5h-4.5Z" />
            <path d="M20.25 21a.75.75 0 0 0 .75-.75v-4.5a.75.75 0 0 0-1.5 0v2.69l-3.97-3.97a.75.75 0 0 0-1.06 1.06l3.97 3.97h-2.69a.75.75 0 0 0 0 1.5h4.5Z" />
            <path d="M3.75 21a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 1 1.5 0v2.69l3.97-3.97a.75.75 0 0 1 1.06 1.06L5.56 19.5h2.69a.75.75 0 0 1 0 1.5h-4.5Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" role="presentation">
            <rect x="10" y="10" width="4" height="4" rx="0.5" />
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M3.22 3.22a.75.75 0 0 1 1.06 0l3.97 3.97V4.5a.75.75 0 0 1 1.5 0V9a.75.75 0 0 1-.75.75H4.5a.75.75 0 0 1 0-1.5h2.69L3.22 4.28a.75.75 0 0 1 0-1.06Zm17.56 0a.75.75 0 0 1 0 1.06l-3.97 3.97h2.69a.75.75 0 0 1 0 1.5H15a.75.75 0 0 1-.75-.75V4.5a.75.75 0 0 1 1.5 0v2.69l3.97-3.97a.75.75 0 0 1 1.06 0ZM3.75 15a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-2.69l-3.97 3.97a.75.75 0 0 1-1.06-1.06l3.97-3.97H4.5a.75.75 0 0 1-.75-.75Zm10.5 0a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-2.69l3.97 3.97a.75.75 0 1 1-1.06 1.06l-3.97-3.97v2.69a.75.75 0 0 1-1.5 0V15Z"
            />
          </svg>
        )}
      </button>

      <button
        type="button"
        className="compact-fab"
        onClick={toggleCompact}
        aria-label={
          isCompact ? "Switch to comfortable view" : "Switch to compact view"
        }
      >
        <span className="fab-tooltip">
          {isCompact ? "Comfortable view" : "Compact view"}
        </span>
        {isCompact ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" role="presentation">
            <path d="M20.25 3a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0V5.56l-3.97 3.97a.75.75 0 0 1-1.06-1.06l3.97-3.97h-2.69a.75.75 0 0 1 0-1.5h4.5Z" />
            <path d="M3.75 3a.75.75 0 0 0-.75.75v4.5a.75.75 0 0 0 1.5 0V5.56l3.97 3.97a.75.75 0 0 0 1.06-1.06L5.56 4.5h2.69a.75.75 0 0 0 0-1.5h-4.5Z" />
            <path d="M20.25 21a.75.75 0 0 0 .75-.75v-4.5a.75.75 0 0 0-1.5 0v2.69l-3.97-3.97a.75.75 0 0 0-1.06 1.06l3.97 3.97h-2.69a.75.75 0 0 0 0 1.5h4.5Z" />
            <path d="M3.75 21a.75.75 0 0 1-.75-.75v-4.5a.75.75 0 0 1 1.5 0v2.69l3.97-3.97a.75.75 0 0 1 1.06 1.06L5.56 19.5h2.69a.75.75 0 0 1 0 1.5h-4.5Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" role="presentation">
            <rect x="10" y="10" width="4" height="4" rx="0.5" />
            <path
              fillRule="evenodd"
              clipRule="evenodd"
              d="M3.22 3.22a.75.75 0 0 1 1.06 0l3.97 3.97V4.5a.75.75 0 0 1 1.5 0V9a.75.75 0 0 1-.75.75H4.5a.75.75 0 0 1 0-1.5h2.69L3.22 4.28a.75.75 0 0 1 0-1.06Zm17.56 0a.75.75 0 0 1 0 1.06l-3.97 3.97h2.69a.75.75 0 0 1 0 1.5H15a.75.75 0 0 1-.75-.75V4.5a.75.75 0 0 1 1.5 0v2.69l3.97-3.97a.75.75 0 0 1 1.06 0ZM3.75 15a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-2.69l-3.97 3.97a.75.75 0 0 1-1.06-1.06l3.97-3.97H4.5a.75.75 0 0 1-.75-.75Zm10.5 0a.75.75 0 0 1 .75-.75h4.5a.75.75 0 0 1 0 1.5h-2.69l3.97 3.97a.75.75 0 1 1-1.06 1.06l-3.97-3.97v2.69a.75.75 0 0 1-1.5 0V15Z"
            />
          </svg>
        )}
      </button>

      <button
        type="button"
        className="theme-fab"
        onClick={toggleTheme}
        aria-label={`Switch to ${activeTheme === "dark" ? "light" : "dark"} mode`}
      >
        <span className="fab-tooltip">
          {activeTheme === "dark" ? "Light mode" : "Dark mode"}
        </span>
        {activeTheme === "dark" ? (
          <svg viewBox="0 0 24 24" aria-hidden="true" role="presentation">
            <path d="M12 17.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11Zm0-13a.75.75 0 0 1-.75-.75v-2a.75.75 0 0 1 1.5 0v2A.75.75 0 0 1 12 4.5Zm0 17a.75.75 0 0 1-.75-.75v-2a.75.75 0 0 1 1.5 0v2a.75.75 0 0 1-.75.75ZM4.5 12a.75.75 0 0 1-.75.75h-2a.75.75 0 0 1 0-1.5h2A.75.75 0 0 1 4.5 12Zm17 0a.75.75 0 0 1-.75.75h-2a.75.75 0 0 1 0-1.5h2a.75.75 0 0 1 .75.75ZM6.165 6.165a.75.75 0 0 1-1.06 0L3.69 4.75a.75.75 0 0 1 1.06-1.06l1.415 1.414a.75.75 0 0 1 0 1.06Zm12.73 12.73a.75.75 0 0 1-1.06 0l-1.415-1.414a.75.75 0 0 1 1.06-1.061l1.415 1.414a.75.75 0 0 1 0 1.061ZM6.165 17.835a.75.75 0 0 1 0 1.06L4.75 20.31a.75.75 0 0 1-1.06-1.06l1.414-1.415a.75.75 0 0 1 1.06 0Zm12.73-12.73a.75.75 0 0 1 0 1.06l-1.414 1.415a.75.75 0 0 1-1.061-1.06l1.414-1.415a.75.75 0 0 1 1.061 0Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" aria-hidden="true" role="presentation">
            <path d="M20.742 14.045A8 8 0 0 1 9.955 3.258a1 1 0 0 0-1.17-1.17A10 10 0 1 0 21.912 15.215a1 1 0 0 0-1.17-1.17Z" />
          </svg>
        )}
      </button>

      {rateLimitWarning ? (
        <div className="toast toast-warning" role="status">
          ⚠ Rate limit hit — showing cached data. Will refresh automatically.
        </div>
      ) : null}
      {errorToast ? (
        <div className="toast toast-error" role="alert">
          ⚠ {errorToast}
        </div>
      ) : null}
    </main>
  );
}

export default App;
