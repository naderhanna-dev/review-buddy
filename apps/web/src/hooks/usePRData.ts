import { useEffect, useRef, useState } from "react";
import {
  prViewKey,
  RateLimitError,
  rateLimitTracker,
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
import type { PullRequest, MergedPullRequest, StalePreference, OrgConfig, OrgCompleteEvent } from "@reviewradar/core";

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
  rateLimitResetMs: number;
  lastRefreshedAt: number | null;
  viewedMap: Record<string, number>;
  stalePreferences: Record<string, StalePreference>;
  isLoadingRef: React.MutableRefObject<boolean>;
  handleViewed: (repository: string, number: number) => void;
  handleMarkStale: (repository: string, number: number) => void;
  handleMarkActive: (repository: string, number: number) => void;
  handleClearStalePreference: (repository: string, number: number) => void;
};

function getMaxResetMs(configs: OrgConfig[]): number {
  let max = 0
  for (const config of configs) {
    const ms = rateLimitTracker.getMsUntilReset(config.token)
    if (ms > max) max = ms
  }
  return max
}

function mergeOrgCaches(orgConfigs: OrgConfig[], mergedLimit: number): {
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
  const seenMergedIds = new Set<number>();
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
    for (const pr of cached.recentlyMerged) {
      if (!seenMergedIds.has(pr.id)) {
        seenMergedIds.add(pr.id);
        allRecentlyMerged.push(pr);
      }
    }
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

  // Sort by most recently merged and enforce the user's limit
  allRecentlyMerged.sort(
    (a, b) => new Date(b.mergedAtIso).getTime() - new Date(a.mergedAtIso).getTime(),
  );
  allRecentlyMerged.splice(mergedLimit);

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
  const [rateLimitResetMs, setRateLimitResetMs] = useState(0);
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
      const merged = mergeOrgCaches(configs, mergedCount);
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
  }, [orgConfigsKey, mergedCount]);

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
    const cached = mergeOrgCaches(configs, mergedCount);
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

    const orgIds = configs.map((c) => c.id);
    if (cached.data && !isAnyCacheStale(orgIds) && !refreshTickChanged) {
      return () => { ignore = true; };
    }

    const allTokensRateLimited = configs.every((c) => rateLimitTracker.isRateLimited(c.token));
    if (allTokensRateLimited) {
      setRateLimitWarning(true);
      setRateLimitResetMs(getMaxResetMs(configs));
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
        // Progressive rendering: update sections as each org completes.
        // The first org to complete replaces (not appends to) the cache-hydrated
        // state so that stale cache entries don't produce duplicates.
        let isFirstOrgComplete = true;

        function handleOrgComplete(event: OrgCompleteEvent): void {
          if (ignore) return;

          if (isFirstOrgComplete) {
            isFirstOrgComplete = false;
            setStalePrs(event.classified.stalePrs);
            setYourPrs(event.classified.yourPrs);
            setNeedsAttention(event.classified.needsAttention);
            setRelatedToYou(event.classified.relatedToYou);
            setRecentlyMerged(event.merged.slice(0, mergedCount));
          } else {
            setStalePrs((prev) => [...prev, ...event.classified.stalePrs]);
            setYourPrs((prev) => [...prev, ...event.classified.yourPrs]);
            setNeedsAttention((prev) => [...prev, ...event.classified.needsAttention]);
            setRelatedToYou((prev) => [...prev, ...event.classified.relatedToYou]);
            setRecentlyMerged((prev) => {
              const seenIds = new Set(prev.map((pr) => pr.id));
              const unique = event.merged.filter((pr) => !seenIds.has(pr.id));
              return [...prev, ...unique].slice(0, mergedCount);
            });
          }
          setLastRefreshedAt(Date.now());

          // Write this org's cache immediately
          writeCachedPRData(event.orgId, event.org, {
            yourPrs: event.classified.yourPrs,
            needsAttention: event.classified.needsAttention,
            relatedToYou: event.classified.relatedToYou,
            stalePrs: event.classified.stalePrs,
            recentlyMerged: event.merged,
            teamSignalsUnavailable: event.classified.teamSignalsUnavailable,
          });
        }

        const isRevalidation = !!cached.data;

        const result = await fetchAllOrgs(
          configs,
          viewedMapRef.current,
          stalePreferences,
          mergedCount,
          isRevalidation ? undefined : handleOrgComplete,
        );

        if (!ignore) {
          // If every org errored and the result is empty, keep the cached
          // data visible instead of wiping the board.
          const allOrgsFailed =
            result.perOrgErrors.length > 0 &&
            result.perOrgErrors.length >= configs.length;
          const resultIsEmpty =
            result.yourPrs.length === 0 &&
            result.needsAttention.length === 0 &&
            result.relatedToYou.length === 0 &&
            result.stalePrs.length === 0 &&
            result.recentlyMerged.length === 0;

          if (!(allOrgsFailed && resultIsEmpty)) {
            // Final state from merged+sorted result replaces the progressive state
            setStalePrs(result.stalePrs);
            setYourPrs(result.yourPrs);
            setNeedsAttention(result.needsAttention);
            setRelatedToYou(result.relatedToYou);
            setTeamSignalsUnavailable(result.teamSignalsUnavailable);
            setRecentlyMerged(result.recentlyMerged);
            setLastRefreshedAt(Date.now());
          }
          const hasRateLimitErrors = result.perOrgErrors.some((e) => e.error === 'rate-limit');
          setRateLimitWarning(hasRateLimitErrors);
          if (hasRateLimitErrors) {
            setRateLimitResetMs(getMaxResetMs(orgConfigsRef.current));
          }

          const nonRateLimitErrors = result.perOrgErrors.filter((e) => e.error !== 'rate-limit');
          if (nonRateLimitErrors.length > 0) {
            const messages = nonRateLimitErrors.map((e) => `${e.org}: ${e.error}`);
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
          setRateLimitResetMs(getMaxResetMs(orgConfigsRef.current));
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
    rateLimitResetMs,
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
