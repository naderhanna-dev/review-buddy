import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { prViewKey } from "./lib/classification";
import type { PullRequest } from "./lib/classification";
import { RateLimitError } from "./lib/github";
import { etagCache } from "./lib/etag-cache";
import {
  getCacheTimestamp,
  invalidatePRCache,
  isCacheStale,
  PR_CACHE_STORAGE_KEY,
  readCachedPRData,
  writeCachedPRData,
} from "./lib/pr-cache";
import { SmartRefreshController } from "./lib/smart-refresh";
import { fetchAndClassifyPullRequests, fetchRecentlyMergedPRs } from "./lib/fetch-prs";
import {
  readCompactPreference,
  readDimViewedPreference,
  readMergedCountPreference,
  readSectionHideDrafts,
  readSectionSortPreferences,
  readStalePreferences,
  readStorageItem,
  readThemePreference,
  readViewedMap,
} from "./lib/storage";
import { applySectionSort, applyDraftFilter, formatRefreshAge } from "./lib/pr-utils";
import { SectionHeader } from "./components/SectionHeader";
import { PullRequestRow } from "./components/PullRequestRow";
import { MergedPrRow } from "./components/MergedPrRow";
import type {
  MergedPullRequest,
  SectionKey,
  SortPreference,
  StalePreference,
  ThemePreference,
} from "./types";
import {
  FALLBACK_REFRESH_MS,
  MERGED_COUNT_DEFAULT,
  MERGED_COUNT_MAX,
  MERGED_COUNT_MIN,
  NOTIFICATION_FALLBACK_MS,
  REFRESH_FOCUS_COOLDOWN_MS,
  STORAGE_KEYS,
} from "./constants";
import "./App.css";

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
  const [isRevalidating, setIsRevalidating] = useState(false);
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
      invalidatePRCache();
      return;
    }

    let ignore = false;

    // Read cache immediately — hydrate state before any network fetch
    const cachedData = readCachedPRData(org);
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
    if (cachedData && !isCacheStale(org)) {
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

  function handleSaveConfig(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const nextToken = tokenInput.trim();
    const nextOrg = orgInput.trim();

    const parsedCount = parseInt(mergedCountInput, 10);
    const nextMergedCount =
      isNaN(parsedCount) ||
      parsedCount < MERGED_COUNT_MIN ||
      parsedCount > MERGED_COUNT_MAX
        ? MERGED_COUNT_DEFAULT
        : parsedCount;

    localStorage.setItem(STORAGE_KEYS.token, nextToken);
    localStorage.setItem(STORAGE_KEYS.org, nextOrg);
    localStorage.setItem(
      STORAGE_KEYS.recentlyMergedCount,
      String(nextMergedCount),
    );

    if (nextToken !== token || nextOrg !== org) {
      invalidatePRCache();
      etagCache.clear();
    }

    setToken(nextToken);
    setOrg(nextOrg);
    setMergedCount(nextMergedCount);
    setMergedCountInput(String(nextMergedCount));
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

  const refreshLabel = isRevalidating
    ? `Updating... (${lastRefreshedAt ? formatRefreshAge(lastRefreshedAt, nowMs) : "loading"})`
    : isLoading
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
