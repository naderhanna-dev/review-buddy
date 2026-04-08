export const SEARCH_PAGE_SIZE = 10;
export const SEARCH_MAX_PAGES = 25;
export const BATCH_SEARCH_CHUNK_SIZE = 3;
export const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
export const FALLBACK_REFRESH_MS = 10 * 60 * 1000;
export const NOTIFICATION_FALLBACK_MS = 2 * 60 * 1000;
export const REFRESH_FOCUS_COOLDOWN_MS = 5 * 60 * 1000;

export const MERGED_COUNT_DEFAULT = 5;
export const MERGED_COUNT_MIN = 1;
export const MERGED_COUNT_MAX = 25;

export const STORAGE_KEYS: Record<
  | "token"
  | "org"
  | "viewed"
  | "theme"
  | "compact"
  | "stalePreferences"
  | "sectionSort"
  | "prCache"
  | "recentlyMergedCount"
  | "sectionHideDrafts"
  | "sectionGroupByRepo"
  | "dimViewed"
  | "showLineChanges"
  | "showLabels"
  | "sectionFilters",
  string
> = {
  token: "review-radar.pat",
  org: "review-radar.org",
  viewed: "review-radar.viewed",
  theme: "review-radar.theme",
  compact: "review-radar.compact",
  stalePreferences: "review-radar.stalePreferences",
  sectionSort: "review-radar.sectionSort",
  prCache: "review-radar.prCache",
  recentlyMergedCount: "review-radar.recentlyMergedCount",
  sectionHideDrafts: "review-radar.sectionHideDrafts",
  dimViewed: "review-radar.dimViewed",
  showLineChanges: "review-radar.showLineChanges",
  showLabels: "review-radar.showLabels",
  sectionGroupByRepo: "review-radar.sectionGroupByRepo",
  sectionFilters: "review-radar.sectionFilters",
};
