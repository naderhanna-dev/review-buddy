// ── Types & Constants ────────────────────────────────────────────────
export type {
  ClassifiedPullRequests,
  MergedPullRequest,
  ThemePreference,
  StalePreference,
  SectionKey,
  SortPreference,
  SectionFilterState,
} from "./types";
export { EMPTY_FILTER_STATE } from "./types";

export {
  SEARCH_PAGE_SIZE,
  SEARCH_MAX_PAGES,
  STALE_AFTER_MS,
  FALLBACK_REFRESH_MS,
  NOTIFICATION_FALLBACK_MS,
  REFRESH_FOCUS_COOLDOWN_MS,
  MERGED_COUNT_DEFAULT,
  MERGED_COUNT_MIN,
  MERGED_COUNT_MAX,
  STORAGE_KEYS,
} from "./constants";

// ── Classification ───────────────────────────────────────────────────
export type {
  CheckStatus,
  PolicyBotStatus,
  PullRequest,
  PullDetails,
  Review,
  PullComment,
  ReviewVerdict,
  ActivitySignals,
  ClassifiedPullRequest,
} from "./classification";
export {
  formatRelativeTime,
  prViewKey,
  sortByUpdatedDesc,
  sortByCreatedAt,
  sortByAuthor,
  sortByRepository,
  sortByLineChanges,
  classifyPullRequest,
} from "./classification";

// ── GitHub API ───────────────────────────────────────────────────────
export { setGitHubApiBase, getGitHubApiBase, resolveGitHubUrl } from "./api-base";
export { RateLimitError, apiFetch } from "./github";

export type {
  GqlViewer,
  GqlTeamsResponse,
  GqlPullRequestNode,
  GqlSearchResponse,
  GqlMergedPullRequestNode,
} from "./graphql";
export {
  PR_DETAILS_FRAGMENT,
  PR_CHECKS_QUERY,
  VIEWER_AND_TEAMS_QUERY,
  SEARCH_OPEN_PRS_QUERY,
  SEARCH_MERGED_PRS_QUERY,
  graphqlFetch,
} from "./graphql";

// ── Caching ──────────────────────────────────────────────────────────
export { EtagCache, etagCache } from "./etag-cache";

export {
  CACHE_SCHEMA_VERSION,
  CACHE_REVALIDATION_TTL_MS,
  CACHE_MAX_AGE_MS,
  PR_CACHE_STORAGE_KEY,
  readCachedPRData,
  isCacheStale,
  writeCachedPRData,
  invalidatePRCache,
  getCacheTimestamp,
} from "./pr-cache";

// ── Notifications & Refresh ──────────────────────────────────────────
export type {
  GitHubNotification,
  NotificationCheckResult,
} from "./notifications";
export {
  filterPrNotifications,
  hasRelevantPrChanges,
  checkForNotificationChanges,
} from "./notifications";

export type { SmartRefreshConfig } from "./smart-refresh";
export { SmartRefreshController } from "./smart-refresh";

// ── Retry ────────────────────────────────────────────────────────────
export type { RetryOptions } from "./retry";
export { delay, withRetry } from "./retry";

// ── Storage ──────────────────────────────────────────────────────────
export {
  readStorageItem,
  readViewedMap,
  readThemePreference,
  readCompactPreference,
  readStalePreferences,
  readMergedCountPreference,
  readSectionSortPreferences,
  readSectionHideDrafts,
  readSectionGroupByRepoPreferences,
  readDimViewedPreference,
  readShowLineChangesPreference,
  readShowLabelsPreference,
  readSectionFilterPreferences,
  writeSectionFilterPreferences,
} from "./storage";

// ── PR Utilities ─────────────────────────────────────────────────────
export {
  applySectionSort,
  applyDraftFilter,
  applySectionFilter,
  formatRefreshAge,
  groupPrsByRepo,
  sortByPriorityAndUpdated,
} from "./pr-utils";

// ── Fetch ────────────────────────────────────────────────────────────
export {
  fetchViewerLogin,
  fetchAndClassifyPullRequests,
  fetchRecentlyMergedPRs,
  fetchPRCheckStatuses,
} from "./fetch-prs";
