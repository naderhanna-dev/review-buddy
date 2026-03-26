import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { etagCache } from "./lib/etag-cache";
import { invalidatePRCache } from "./lib/pr-cache";
import {
  readCompactPreference,
  readDimViewedPreference,
  readMergedCountPreference,
  readSectionHideDrafts,
  readSectionSortPreferences,
  readStorageItem,
  readThemePreference,
} from "./lib/storage";
import { applySectionSort, applyDraftFilter, formatRefreshAge } from "./lib/pr-utils";
import { usePRData } from "./hooks/usePRData";
import { useRefreshTick } from "./hooks/useRefreshTick";
import { useMenuDismiss } from "./hooks/useMenuDismiss";
import { PrSection } from "./components/PrSection";
import { RecentlyMergedSection } from "./components/RecentlyMergedSection";
import { SettingsDrawer } from "./components/SettingsDrawer";
import { UserFilterBar } from "./components/UserFilterBar";
import type { SectionKey, SortPreference, ThemePreference } from "./types";
import {
  MERGED_COUNT_DEFAULT,
  MERGED_COUNT_MAX,
  MERGED_COUNT_MIN,
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
  const [mergedCount, setMergedCount] = useState(() => readMergedCountPreference());
  const [mergedCountInput, setMergedCountInput] = useState(() =>
    String(readMergedCountPreference()),
  );
  const [isConnectionPanelOpen, setIsConnectionPanelOpen] = useState(() => {
    const savedToken = readStorageItem(STORAGE_KEYS.token);
    const savedOrg = readStorageItem(STORAGE_KEYS.org);
    return !(savedToken && savedOrg);
  });
  const [isCompact, setIsCompact] = useState(() => readCompactPreference());
  const [dimViewed, setDimViewed] = useState(() => readDimViewedPreference());
  const [themePreference, setThemePreference] = useState<ThemePreference>(() =>
    readThemePreference(),
  );
  const [isStaleSectionOpen, setIsStaleSectionOpen] = useState(false);
  const [isNeedsAttentionOpen, setIsNeedsAttentionOpen] = useState(true);
  const [isYourPrsOpen, setIsYourPrsOpen] = useState(true);
  const [isRelatedToYouOpen, setIsRelatedToYouOpen] = useState(true);
  const [sectionSortPreferences, setSectionSortPreferences] = useState<
    Record<SectionKey, SortPreference>
  >(readSectionSortPreferences);
  const [sectionHideDrafts, setSectionHideDrafts] = useState<
    Record<SectionKey, boolean>
  >(readSectionHideDrafts);
  const [refreshTick, setRefreshTick] = useState(0);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [needsAttentionUserFilter, setNeedsAttentionUserFilter] = useState<string | null>(null);

  const handleRefresh = useCallback(() => {
    setRefreshTick((current) => current + 1);
  }, []);

  const prData = usePRData({ org, token, mergedCount, refreshTick });

  useRefreshTick({
    org,
    token,
    isLoadingRef: prData.isLoadingRef,
    onRefresh: handleRefresh,
  });

  const menu = useMenuDismiss();

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
    localStorage.setItem(STORAGE_KEYS.recentlyMergedCount, String(nextMergedCount));

    if (nextToken !== token || nextOrg !== org) {
      invalidatePRCache();
      etagCache.clear();
    }

    setToken(nextToken);
    setOrg(nextOrg);
    setMergedCount(nextMergedCount);
    setMergedCountInput(String(nextMergedCount));
    setIsConnectionPanelOpen(!nextToken || !nextOrg);
  }

  function handleMergedCountChange(rawValue: string): void {
    setMergedCountInput(rawValue);
    const parsed = parseInt(rawValue, 10);
    if (!isNaN(parsed) && parsed >= MERGED_COUNT_MIN && parsed <= MERGED_COUNT_MAX) {
      setMergedCount(parsed);
      localStorage.setItem(STORAGE_KEYS.recentlyMergedCount, String(parsed));
    }
  }

  function handleSetSectionSort(sectionKey: SectionKey, sort: SortPreference): void {
    setSectionSortPreferences((current) => {
      const next = { ...current, [sectionKey]: sort };
      localStorage.setItem(STORAGE_KEYS.sectionSort, JSON.stringify(next));
      return next;
    });
    menu.handleCloseSectionMenu();
  }

  function handleToggleSectionHideDrafts(sectionKey: SectionKey): void {
    setSectionHideDrafts((current) => {
      const next = { ...current, [sectionKey]: !current[sectionKey] };
      localStorage.setItem(STORAGE_KEYS.sectionHideDrafts, JSON.stringify(next));
      return next;
    });
  }

  function toggleTheme(): void {
    const activeTheme = resolveTheme(themePreference);
    const nextPreference: ThemePreference = activeTheme === "dark" ? "light" : "dark";
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

  const hasCredentials = Boolean(token && org);
  const activeTheme = resolveTheme(themePreference);

  const displayNeedsAttention = applyDraftFilter(
    applySectionSort(prData.needsAttention, sectionSortPreferences.needsAttention),
    sectionHideDrafts.needsAttention,
  );

  const needsAttentionUsers = useMemo(() => {
    const seen = new Map<string, string>();
    for (const pr of displayNeedsAttention) {
      if (!seen.has(pr.author)) {
        seen.set(pr.author, pr.authorAvatarUrl);
      }
      for (const r of pr.requestedReviewers) {
        if (!seen.has(r.login)) {
          seen.set(r.login, r.avatarUrl);
        }
      }
    }
    return Array.from(seen, ([login, avatarUrl]) => ({ login, avatarUrl }));
  }, [displayNeedsAttention]);

  const filteredNeedsAttention = useMemo(() => {
    if (!needsAttentionUserFilter) return displayNeedsAttention;
    return displayNeedsAttention.filter(
      (pr) =>
        pr.author === needsAttentionUserFilter ||
        pr.requestedReviewers.some((r) => r.login === needsAttentionUserFilter),
    );
  }, [displayNeedsAttention, needsAttentionUserFilter]);

  useEffect(() => {
    if (
      needsAttentionUserFilter &&
      !needsAttentionUsers.some((u) => u.login === needsAttentionUserFilter)
    ) {
      setNeedsAttentionUserFilter(null);
    }
  }, [needsAttentionUsers, needsAttentionUserFilter]);

  const displayYourPrs = applyDraftFilter(
    applySectionSort(prData.yourPrs, sectionSortPreferences.yourPrs),
    sectionHideDrafts.yourPrs,
  );
  const displayRelatedToYou = applyDraftFilter(
    applySectionSort(prData.relatedToYou, sectionSortPreferences.relatedToYou),
    sectionHideDrafts.relatedToYou,
  );
  const displayStalePrs = applyDraftFilter(
    applySectionSort(prData.stalePrs, sectionSortPreferences.stalePrs),
    sectionHideDrafts.stalePrs,
  );

  const refreshLabel = prData.isRevalidating
    ? `Updating... (${prData.lastRefreshedAt ? formatRefreshAge(prData.lastRefreshedAt, nowMs) : "loading"})`
    : prData.isLoading
      ? "Refreshing..."
      : prData.lastRefreshedAt
        ? `Last updated ${formatRefreshAge(prData.lastRefreshedAt, nowMs)}`
        : "Not refreshed yet";

  const sharedSectionProps = {
    openSectionMenuKey: menu.openSectionMenuKey,
    onToggleSectionMenu: menu.handleToggleSectionMenu,
    onSetSort: handleSetSectionSort,
    dimViewed,
    viewedMap: prData.viewedMap,
    stalePreferences: prData.stalePreferences,
    openMenuKey: menu.openRowMenuKey,
    onViewed: prData.handleViewed,
    onToggleMenu: menu.handleToggleRowMenu,
    onCloseMenu: menu.handleCloseRowMenu,
    onMarkStale: prData.handleMarkStale,
    onMarkActive: prData.handleMarkActive,
    onClearStalePreference: prData.handleClearStalePreference,
    isLoading: prData.isLoading,
    hasCredentials,
  };

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

      <PrSection
        {...sharedSectionProps}
        title="Needs your attention"
        sectionKey="needsAttention"
        sectionKind="active"
        prs={filteredNeedsAttention}
        isOpen={isNeedsAttentionOpen}
        onToggleOpen={() => setIsNeedsAttentionOpen((current) => !current)}
        emptyConnectedMessage="Nothing currently needs your immediate attention."
        emptyDisconnectedMessage="Add org + PAT above to classify pull requests."
        updatedCount={filteredNeedsAttention.filter((pr) => pr.stateLabel).length}
        statusLabel={prData.isLoading && !prData.lastRefreshedAt ? "Classifying..." : undefined}
        sortPreference={sectionSortPreferences.needsAttention}
        hideDrafts={sectionHideDrafts.needsAttention}
        onToggleHideDrafts={() => handleToggleSectionHideDrafts("needsAttention")}
        filterBar={
          needsAttentionUsers.length > 1 ? (
            <UserFilterBar
              users={needsAttentionUsers}
              selectedLogin={needsAttentionUserFilter}
              onSelect={setNeedsAttentionUserFilter}
            />
          ) : undefined
        }
      />

      <PrSection
        {...sharedSectionProps}
        title="Your PRs"
        sectionKey="yourPrs"
        sectionKind="active"
        prs={displayYourPrs}
        isOpen={isYourPrsOpen}
        onToggleOpen={() => setIsYourPrsOpen((current) => !current)}
        emptyConnectedMessage="No assigned or authored pull requests right now."
        emptyDisconnectedMessage="Add org + PAT above to load pull requests from GitHub."
        updatedCount={displayYourPrs.filter((pr) => pr.stateLabel).length}
        statusLabel={prData.isLoading && !prData.lastRefreshedAt ? "Loading..." : undefined}
        sortPreference={sectionSortPreferences.yourPrs}
        hideDrafts={sectionHideDrafts.yourPrs}
        onToggleHideDrafts={() => handleToggleSectionHideDrafts("yourPrs")}
      />

      <PrSection
        {...sharedSectionProps}
        title="Related to you"
        sectionKey="relatedToYou"
        sectionKind="active"
        prs={displayRelatedToYou}
        isOpen={isRelatedToYouOpen}
        onToggleOpen={() => setIsRelatedToYouOpen((current) => !current)}
        emptyConnectedMessage="No non-urgent related pull requests right now."
        emptyDisconnectedMessage="Add org + PAT above to load pull requests from GitHub."
        updatedCount={displayRelatedToYou.filter((pr) => pr.stateLabel).length}
        statusLabel={prData.isLoading && !prData.lastRefreshedAt ? "Loading..." : undefined}
        sortPreference={sectionSortPreferences.relatedToYou}
        hideDrafts={sectionHideDrafts.relatedToYou}
        onToggleHideDrafts={() => handleToggleSectionHideDrafts("relatedToYou")}
      />

      <RecentlyMergedSection
        recentlyMerged={prData.recentlyMerged}
        isLoading={prData.isLoading}
        lastRefreshedAt={prData.lastRefreshedAt}
        hasCredentials={hasCredentials}
      />

      <PrSection
        {...sharedSectionProps}
        title="Stale PRs"
        sectionKey="stalePrs"
        sectionKind="stale"
        prs={displayStalePrs}
        isOpen={isStaleSectionOpen}
        onToggleOpen={() => setIsStaleSectionOpen((current) => !current)}
        emptyConnectedMessage="No stale pull requests right now."
        emptyDisconnectedMessage="Add org + PAT above to load pull requests from GitHub."
        sortPreference={sectionSortPreferences.stalePrs}
        hideDrafts={sectionHideDrafts.stalePrs}
        onToggleHideDrafts={() => handleToggleSectionHideDrafts("stalePrs")}
      />

      {isConnectionPanelOpen ? (
        <SettingsDrawer
          org={org}
          hasSavedConnection={Boolean(token && org)}
          tokenInput={tokenInput}
          setTokenInput={setTokenInput}
          orgInput={orgInput}
          setOrgInput={setOrgInput}
          onSubmit={handleSaveConfig}
          mergedCountInput={mergedCountInput}
          onMergedCountChange={handleMergedCountChange}
          mergedCount={mergedCount}
          onMergedCountBlur={() => setMergedCountInput(String(mergedCount))}
          dimViewed={dimViewed}
          onToggleDimViewed={toggleDimViewed}
          teamSignalsUnavailable={prData.teamSignalsUnavailable}
          onClose={() => setIsConnectionPanelOpen(false)}
        />
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

      {prData.rateLimitWarning ? (
        <div className="toast toast-warning" role="status">
          ⚠ Rate limit hit — showing cached data. Will refresh automatically.
        </div>
      ) : null}
      {prData.errorToast ? (
        <div className="toast toast-error" role="alert">
          ⚠ {prData.errorToast}
        </div>
      ) : null}
    </main>
  );
}

export default App;
