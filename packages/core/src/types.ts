import type { PullRequest } from "./classification";

export type ClassifiedPullRequests = {
  yourPrs: PullRequest[];
  needsAttention: PullRequest[];
  relatedToYou: PullRequest[];
  stalePrs: PullRequest[];
  teamSignalsUnavailable: string | null;
  closedViewedKeys: string[];
};

export type MergedPullRequest = {
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

export type ThemePreference = "system" | "dark" | "light";
export type StalePreference = "stale" | "active";
export type SectionKey = "needsAttention" | "yourPrs" | "relatedToYou" | "stalePrs";
export type SortPreference = "default" | "oldest-first" | "newest-first" | "author-az" | "line-changes-desc";

export type SectionFilterState = {
  repository: ReadonlySet<string>;
  checkStatus: ReadonlySet<string>;
  labels: ReadonlySet<string>;
  author: ReadonlySet<string>;
};

export const EMPTY_FILTER_STATE: SectionFilterState = {
  repository: new Set(),
  checkStatus: new Set(),
  labels: new Set(),
  author: new Set(),
};

export type OrgConfig = {
  id: string;
  org: string;
  token: string;
};
