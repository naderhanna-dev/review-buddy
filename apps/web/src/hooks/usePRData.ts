import { useEffect, useRef, useState } from "react";
import {
  prViewKey,
  RateLimitError,
  getCacheTimestamp,
  invalidatePRCache,
  isCacheStale,
  PR_CACHE_STORAGE_KEY,
  readCachedPRData,
  writeCachedPRData,
  fetchAndClassifyPullRequests,
  fetchRecentlyMergedPRs,
  fetchViewerLogin,
  readStalePreferences,
  readViewedMap,
  STORAGE_KEYS,
} from "@reviewradar/core";
import type { PullRequest, MergedPullRequest, StalePreference } from "@reviewradar/core";

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

export function usePRData({
  org,
  token,
  mergedCount,
  refreshTick,
}: {
  org: string;
  token: string;
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

  useEffect(() => {
    isLoadingRef.current = isLoading;
  }, [isLoading]);

  useEffect(() => {
    viewedMapRef.current = viewedMap;
  }, [viewedMap]);

  useEffect(() => {
    function handleStorageEvent(event: StorageEvent): void {
      if (event.key !== PR_CACHE_STORAGE_KEY || event.newValue === null) {
        return;
      }

      const crossTabData = readCachedPRData(org);
      if (!crossTabData) {
        return;
      }

      setStalePrs(crossTabData.stalePrs);
      setYourPrs(crossTabData.yourPrs);
      setNeedsAttention(crossTabData.needsAttention);
      setRelatedToYou(crossTabData.relatedToYou);
      setRecentlyMerged(crossTabData.recentlyMerged);
      setTeamSignalsUnavailable(crossTabData.teamSignalsUnavailable);
      const crossTabTimestamp = getCacheTimestamp(org);
      if (crossTabTimestamp) {
        setLastRefreshedAt(crossTabTimestamp);
      }
    }

    window.addEventListener("storage", handleStorageEvent);
    return () => {
      window.removeEventListener("storage", handleStorageEvent);
    };
  }, [org]);

  useEffect(() => {
    if (!token || !org) {
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

    // Read cache immediately — hydrate state before any network fetch
    const cachedData = readCachedPRData(org);
    const refreshTickChanged = refreshTickRef.current !== refreshTick;
    refreshTickRef.current = refreshTick;
    if (cachedData && !ignore) {
      setStalePrs(cachedData.stalePrs);
      setYourPrs(cachedData.yourPrs);
      setNeedsAttention(cachedData.needsAttention);
      setRelatedToYou(cachedData.relatedToYou);
      setRecentlyMerged(cachedData.recentlyMerged);
      setTeamSignalsUnavailable(cachedData.teamSignalsUnavailable);
      const cachedTimestamp = getCacheTimestamp(org);
      if (cachedTimestamp) {
        setLastRefreshedAt(cachedTimestamp);
      }
    }

    // If cache is fresh, skip the network fetch — SmartRefreshController will trigger refreshTick when stale
    if (cachedData && !isCacheStale(org) && !refreshTickChanged) {
      return () => { ignore = true; };
    }

    async function loadAndClassifyPulls(): Promise<void> {
      if (cachedData) {
        setIsRevalidating(true);
      } else {
        setIsLoading(true);
      }
      setErrorToast(null);

      try {
        const viewerLogin = await fetchViewerLogin(token);
        const [classified, merged] = await Promise.all([
          fetchAndClassifyPullRequests(
            org,
            token,
            viewerLogin,
            viewedMapRef.current,
            stalePreferences,
          ),
          fetchRecentlyMergedPRs(org, token, mergedCount, viewerLogin),
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
              const next = { ...current };
              for (const key of classified.closedViewedKeys) {
                delete next[key];
              }
              localStorage.setItem(STORAGE_KEYS.viewed, JSON.stringify(next));
              return next;
            });
          }

          writeCachedPRData(org, {
            yourPrs: classified.yourPrs,
            needsAttention: classified.needsAttention,
            relatedToYou: classified.relatedToYou,
            stalePrs: classified.stalePrs,
            recentlyMerged: merged,
            teamSignalsUnavailable: classified.teamSignalsUnavailable,
          });
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
  }, [mergedCount, org, refreshTick, stalePreferences, token]);

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
