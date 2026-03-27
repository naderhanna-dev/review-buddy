import type { ThemePreference, StalePreference, SectionKey, SortPreference } from "../types";
import { STORAGE_KEYS, MERGED_COUNT_DEFAULT, MERGED_COUNT_MIN, MERGED_COUNT_MAX } from "../constants";

const VALID_SORT_VALUES: ReadonlySet<string> = new Set([
  "oldest-first",
  "newest-first",
  "author-az",
  "repo-az",
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
