import type { ThemePreference, StalePreference, SectionKey, SortPreference, SectionFilterState } from "../types";
import { STORAGE_KEYS, MERGED_COUNT_DEFAULT, MERGED_COUNT_MIN, MERGED_COUNT_MAX } from "../constants";
import { EMPTY_FILTER_STATE } from "../types";

const VALID_SORT_VALUES: ReadonlySet<string> = new Set([
  "oldest-first",
  "newest-first",
  "author-az",
  "line-changes-desc",
]);

const DEFAULT_SECTION_SORT: Record<SectionKey, SortPreference> = {
  needsAttention: "default",
  yourPrs: "default",
  relatedToYou: "default",
  stalePrs: "default",
};

const DEFAULT_SECTION_HIDE_DRAFTS: Record<SectionKey, boolean> = {
  needsAttention: false,
  yourPrs: false,
  relatedToYou: false,
  stalePrs: false,
};

const DEFAULT_SECTION_GROUP_BY_REPO: Record<SectionKey, boolean> = {
  needsAttention: false,
  yourPrs: false,
  relatedToYou: false,
  stalePrs: false,
};

export function readStorageItem(key: string): string {
  if (typeof window === "undefined") {
    return "";
  }

  return localStorage.getItem(key) ?? "";
}

export function readViewedMap(): Record<string, number> {
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

export function readThemePreference(): ThemePreference {
  const value = readStorageItem(STORAGE_KEYS.theme);
  if (value === "dark" || value === "light" || value === "system") {
    return value;
  }

  return "system";
}

export function readCompactPreference(): boolean {
  return readStorageItem(STORAGE_KEYS.compact) === "true";
}

export function readStalePreferences(): Record<string, StalePreference> {
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

export function readMergedCountPreference(): number {
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

export function readSectionSortPreferences(): Record<SectionKey, SortPreference> {
   const raw = readStorageItem(STORAGE_KEYS.sectionSort);
   if (!raw) {
     return { ...DEFAULT_SECTION_SORT };
   }

   try {
     const parsed = JSON.parse(raw) as Record<string, string>;
     const result = { ...DEFAULT_SECTION_SORT };
     for (const key of Object.keys(result) as SectionKey[]) {
       const val = parsed[key];
       if (VALID_SORT_VALUES.has(val)) {
         result[key] = val as SortPreference;
       }
     }
     // "author-az" sort was removed from "Your PRs" section
     if (result.yourPrs === "author-az") {
       result.yourPrs = "default";
     }
     return result;
   } catch {
     return { ...DEFAULT_SECTION_SORT };
   }
}

export function readSectionHideDrafts(): Record<SectionKey, boolean> {
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

export function readSectionGroupByRepoPreferences(): Record<SectionKey, boolean> {
  const raw = readStorageItem(STORAGE_KEYS.sectionGroupByRepo);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const result = { ...DEFAULT_SECTION_GROUP_BY_REPO };
      for (const key of Object.keys(result) as SectionKey[]) {
        if (parsed[key] === true) {
          result[key] = true;
        }
      }
      return result;
    } catch {
      // fall through to migration
    }
  }

  // Migration: if any section was sorted by "repo-az", auto-enable grouping
  const sortRaw = readStorageItem(STORAGE_KEYS.sectionSort);
  if (sortRaw) {
    try {
      const sortParsed = JSON.parse(sortRaw) as Record<string, string>;
      const result = { ...DEFAULT_SECTION_GROUP_BY_REPO };
      let migrated = false;
      for (const key of Object.keys(result) as SectionKey[]) {
        if (sortParsed[key] === "repo-az") {
          result[key] = true;
          migrated = true;
        }
      }
      if (migrated) {
        localStorage.setItem(STORAGE_KEYS.sectionGroupByRepo, JSON.stringify(result));
        return result;
      }
    } catch {
      // ignore
    }
  }

  return { ...DEFAULT_SECTION_GROUP_BY_REPO };
}

export function readDimViewedPreference(): boolean {
  const raw = readStorageItem(STORAGE_KEYS.dimViewed);
  if (raw === "false") {
    return false;
  }
  return true;
}

export function readShowLineChangesPreference(): boolean {
  const raw = readStorageItem(STORAGE_KEYS.showLineChanges);
  if (raw === "false") {
    return false;
  }
  return true;
}

export function readShowLabelsPreference(): boolean {
  const raw = readStorageItem(STORAGE_KEYS.showLabels);
  if (raw === "false") {
    return false;
  }
  return true;
}

export function readSectionFilterPreferences(): Record<SectionKey, SectionFilterState> {
  const raw = readStorageItem(STORAGE_KEYS.sectionFilters);
  if (!raw) {
    return {
      needsAttention: { ...EMPTY_FILTER_STATE },
      yourPrs: { ...EMPTY_FILTER_STATE },
      relatedToYou: { ...EMPTY_FILTER_STATE },
      stalePrs: { ...EMPTY_FILTER_STATE },
    };
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, {
      repository?: string[];
      checkStatus?: string[];
      labels?: string[];
      author?: string[];
    }>;
    const result: Record<SectionKey, SectionFilterState> = {
      needsAttention: { ...EMPTY_FILTER_STATE },
      yourPrs: { ...EMPTY_FILTER_STATE },
      relatedToYou: { ...EMPTY_FILTER_STATE },
      stalePrs: { ...EMPTY_FILTER_STATE },
    };
    for (const key of Object.keys(result) as SectionKey[]) {
      const raw = parsed[key];
      if (raw && typeof raw === "object") {
        result[key] = {
          repository: new Set(Array.isArray(raw.repository) ? raw.repository : []),
          checkStatus: new Set(Array.isArray(raw.checkStatus) ? raw.checkStatus : []),
          labels: new Set(Array.isArray(raw.labels) ? raw.labels : []),
          author: new Set(Array.isArray(raw.author) ? raw.author : []),
        };
      }
    }
    return result;
  } catch {
    return {
      needsAttention: { ...EMPTY_FILTER_STATE },
      yourPrs: { ...EMPTY_FILTER_STATE },
      relatedToYou: { ...EMPTY_FILTER_STATE },
      stalePrs: { ...EMPTY_FILTER_STATE },
    };
  }
}

export function writeSectionFilterPreferences(
  prefs: Record<SectionKey, SectionFilterState>,
): void {
  if (typeof window === "undefined") return;
  const serializable: Record<string, { repository: string[]; checkStatus: string[]; labels: string[]; author: string[] }> = {};
  for (const key of Object.keys(prefs) as SectionKey[]) {
    const f = prefs[key];
    serializable[key] = {
      repository: Array.from(f.repository),
      checkStatus: Array.from(f.checkStatus),
      labels: Array.from(f.labels),
      author: Array.from(f.author),
    };
  }
  localStorage.setItem(STORAGE_KEYS.sectionFilters, JSON.stringify(serializable));
}
