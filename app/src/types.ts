import type { PullRequest } from "./lib/classification";

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
export type SortPreference = "default" | "oldest-first" | "newest-first";
