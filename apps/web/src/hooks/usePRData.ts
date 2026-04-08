import { useEffect, useRef, useState } from "react";
import {
  prViewKey,
  RateLimitError,
  getCacheTimestamp,
  invalidatePRCache,
  isAnyCacheStale,
  PR_CACHE_STORAGE_KEY,
  readCachedPRData,
  writeCachedPRData,
  fetchAllOrgs,
  readStalePreferences,
  readViewedMap,
  STORAGE_KEYS,
} from "@reviewradar/core";
import type { PullRequest, MergedPullRequest, StalePreference, OrgConfig } from "@reviewradar/core";

export type PRDataResult = {
  stalePrs: PullRequest[];
  yourPrs: PullRequest[];
  needsAttention: PullRequest[];
  relatedToYou: PullRequest[];
  recentlyMerged: MergedPullRequest[];
  teamSignalsUnavailable: string | null;
  isLoading: boolean;
  isRevalidating: boolean;
  errorToast: string | null;
  rateLimitWarning: boolean;
  lastRefreshedAt: number | null;
  viewedMap: Record<string, number>;
  stalePreferences: Record<string, StalePreference>;
  isLoadingRef: React.MutableRefObject<boolean>;
  handleViewed: (repository: string, number: number) => void;
  handleMarkStale: (repository: string, number: number) => void;
  handleMarkActive: (repository: string, number: number) => void;
  handleClearStalePreference: (repository: string, number: number) => void;
};

function mergeOrgCaches(orgConfigs: OrgConfig[]): {
  data: {
    yourPrs: PullRequest[];
    needsAttention: PullRequest[];
    relatedToYou: PullRequest[];
    stalePrs: PullRequest[];
    recentlyMerged: MergedPullRequest[];
    teamSignalsUnavailable: string | null;
  } | null;
  lastRefreshedAt: number | null;
} {
  if (orgConfigs.length === 0) {
    return { data: null, lastRefreshedAt: null };
  }

  const allYourPrs: PullRequest[] = [];
  const allNeedsAttention: PullRequest[] = [];
  const allRelatedToYou: PullRequest[] = [];
  const allStalePrs: PullRequest[] = [];
  const allRecentlyMerged: MergedPullRequest[] = [];
  const teamWarnings: string[] = [];
  let hasAnyData = false;
  let oldest: number | null = null;

  for (const config of orgConfigs) {
    const cached = readCachedPRData(config.id);
    if (!cached) continue;

    hasAnyData = true;
    allYourPrs.push(...cached.yourPrs);
    allNeedsAttention.push(...cached.needsAttention);
    allRelatedToYou.push(...cached.relatedToYou);
    allStalePrs.push(...cached.stalePrs);
    allRecentlyMerged.push(...cached.recentlyMerged);
    if (cached.teamSignalsUnavailable) {
      teamWarnings.push(cached.teamSignalsUnavailable);
    }

    const ts = getCacheTimestamp(config.id);
    if (ts !== null && (oldest === null || ts < oldest)) {
      oldest = ts;
    }
  }

  if (!hasAnyData) {
    return { data: null, lastRefreshedAt: null };
  }

  return {
    data: {
      yourPrs: allYourPrs,
      needsAttention: allNeedsAttention,
      relatedToYou: allRelatedToYou,
      stalePrs: allStalePrs,
      recentlyMerged: allRecentlyMerged,
      teamSignalsUnavailable: teamWarnings.length > 0 ? teamWarnings.join(" ") : null,
    },
    lastRefreshedAt: oldest,
  };
}

export function usePRData({
  orgConfigs,
  mergedCount,
  refreshTick,
}: {
  orgConfigs: OrgConfig[];
  mergedCount: number;
  refreshTick: number;
}): PRDataResult {
  const [viewedMap, setViewedMap] = useState<Record<string, number>>(readViewedMap);
  const [stalePreferences, setStalePreferences] = useState<Record<string, StalePreference>>(readStalePreferences);
  const [isLoading, setIsLoading] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [errorToast, setErrorToast] = useState<string | null>(null);
  const [rateLimitWarning, setRateLimitWarning] = useState(false);
  const [teamSignalsUnavailable, setTeamSignalsUnavailable] = useState<string | null>(null);
  const [stalePrs, setStalePrs] = useState<PullRequest[]>([]);
  const [yourPrs, setYourPrs] = useState<PullRequest[]>([]);
  const [needsAttention, setNeedsAttention] = useState<PullRequest[]>([]);
  const [relatedToYou, setRelatedToYou] = useState<PullRequest[]>([]);
  const [recentlyMerged, setRecentlyMerged] = useState<MergedPullRequest[]>([]);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);

  const isLoadingRef = useRef(false);
  const viewedMapRef = useRef<Record<string, number>>(viewedMap);
  const refreshTickRef = useRef(refreshTick);
  const orgConfigsRef = useRef(orgConfigs);

  // Stable serialized key to detect orgConfigs changes without object identity issues
  const orgConfigsKey = JSON.stringify(orgConfigs.map((c) => `${c.id}:${c.org}:${c.token}`));
  orgConfigsRef.current = orgConfigs;

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    viewedMapRef.current = viewedMap;
  }, [viewedMap]);

  // Cross-tab cache sync
  useEffect(() => {
    function handleStorageEvent(event: StorageEvent): void {
      if (event.key !== PR_CACHE_STORAGE_KEY || event.newValue === null) {
        return;
      }

      const configs = orgConfigsRef.current;
      const merged = mergeOrgCaches(configs);
      if (!merged.data) {
        return;
      }

      setStalePrs(merged.data.stalePrs);
      setYourPrs(merged.data.yourPrs);
      setNeedsAttention(merged.data.needsAttention);
      setRelatedToYou(merged.data.relatedToYou);
      setRecentlyMerged(merged.data.recentlyMerged);
      setTeamSignalsUnavailable(merged.data.teamSignalsUnavailable);
      if (merged.lastRefreshedAt) {
        setLastRefreshedAt(merged.lastRefreshedAt);
      }
    }

    window.addEventListener("storage", handleStorageEvent);
    return () => {
      window.removeEventListener("storage", handleStorageEvent);
    };
  }, [orgConfigsKey]);

  useEffect(() => {
    const configs = orgConfigsRef.current;
    const hasConfigs = configs.length > 0 && configs.every((c) => c.org && c.token);

    if (!hasConfigs) {
      setStalePrs([]);
      setYourPrs([]);
      setNeedsAttention([]);
      setRelatedToYou([]);
      setRecentlyMerged([]);
      setTeamSignalsUnavailable(null);
      invalidatePRCache();
      return;
    }

    let ignore = false;

    // Read cache immediately -- hydrate state before any network fetch
    const cached = mergeOrgCaches(configs);
    const refreshTickChanged = refreshTickRef.current !== refreshTick;
    refreshTickRef.current = refreshTick;
    if (cached.data && !ignore) {
      setStalePrs(cached.data.stalePrs);
      setYourPrs(cached.data.yourPrs);
      setNeedsAttention(cached.data.needsAttention);
      setRelatedToYou(cached.data.relatedToYou);
      setRecentlyMerged(cached.data.recentlyMerged);
      setTeamSignalsUnavailable(cached.data.teamSignalsUnavailable);
      if (cached.lastRefreshedAt) {
        setLastRefreshedAt(cached.lastRefreshedAt);
      }
    }

    // If all caches are fresh, skip the network fetch
    const orgIds = configs.map((c) => c.id);
    if (cached.data && !isAnyCacheStale(orgIds) && !refreshTickChanged) {
      return () => { ignore = true; };
    }

    async function loadAndClassifyPulls(): Promise<void> {
      if (cached.data) {
        setIsRevalidating(true);
      } else {
        setIsLoading(true);
      }
      setErrorToast(null);

      try {
        const result = await fetchAllOrgs(
          configs,
          viewedMapRef.current,
          stalePreferences,
          mergedCount,
        );

        if (!ignore) {
          setStalePrs(result.stalePrs);
          setYourPrs(result.yourPrs);
          setNeedsAttention(result.needsAttention);
          setRelatedToYou(result.relatedToYou);
          setTeamSignalsUnavailable(result.teamSignalsUnavailable);
          setRecentlyMerged(result.recentlyMerged);
          setLastRefreshedAt(Date.now());
          setRateLimitWarning(false);

          // Show per-org errors as toasts
          if (result.perOrgErrors.length > 0) {
            const messages = result.perOrgErrors.map((e) => `${e.org}: ${e.error}`);
            setErrorToast(messages.join(" | "));
          }

          if (result.closedViewedKeys.length > 0) {
            setViewedMap((current) => {
              const next = { ...current };
              for (const key of result.closedViewedKeys) {
                delete next[key];
              }
              localStorage.setItem(STORAGE_KEYS.viewed, JSON.stringify(next));
              return next;
            });
          }

          // Write per-org caches
          for (const config of configs) {
            // Filter PRs belonging to this org by repository prefix
            const orgPrefix = `${config.org}/`.toLowerCase();
            const filterByOrg = (prs: PullRequest[]): PullRequest[] =>
              prs.filter((pr) => pr.repository.toLowerCase().startsWith(orgPrefix));

            writeCachedPRData(config.id, config.org, {
              yourPrs: filterByOrg(result.yourPrs),
              needsAttention: filterByOrg(result.needsAttention),
              relatedToYou: filterByOrg(result.relatedToYou),
              stalePrs: filterByOrg(result.stalePrs),
              recentlyMerged: result.recentlyMerged.filter(
                (pr) => pr.repository.toLowerCase().startsWith(orgPrefix),
              ),
              teamSignalsUnavailable: result.teamSignalsUnavailable,
            });
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
          setIsRevalidating(false);
        }
      }
    }

    void loadAndClassifyPulls();

    return () => {
      ignore = true;
    };
  }, [mergedCount, orgConfigsKey, refreshTick, stalePreferences]); // eslint-disable-line react-hooks/exhaustive-deps

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

  function handleClearStalePreference(repository: string, number: number): void {
    updateStalePreference(repository, number);
  }

  return {
    stalePrs,
    yourPrs,
    needsAttention,
    relatedToYou,
    recentlyMerged,
    teamSignalsUnavailable,
    isLoading,
    isRevalidating,
    errorToast,
    rateLimitWarning,
    lastRefreshedAt,
    viewedMap,
    stalePreferences,
    isLoadingRef,
    handleViewed,
    handleMarkStale,
    handleMarkActive,
    handleClearStalePreference,
  };
}
