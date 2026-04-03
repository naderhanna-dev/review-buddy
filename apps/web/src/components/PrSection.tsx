import { useMemo } from "react";
import { prViewKey, groupPrsByRepo } from "@reviewradar/core";
import type { PullRequest, SectionFilterState, SectionKey, SortPreference, StalePreference } from "@reviewradar/core";
import { SectionHeader } from "./SectionHeader";
import { PullRequestRow } from "./PullRequestRow";

export function PrSection({
  title,
  sectionKey,
  sectionKind,
  prs,
  isOpen,
  onToggleOpen,
  emptyConnectedMessage,
  emptyDisconnectedMessage,
  isLoading,
  token,
  hasCredentials,
  statusLabel,
  openSectionMenuKey,
  openSectionFilterKey,
  sortPreference,
  filterPreference,
  unfilteredPrs,
  hideAuthorFilter,
  hideDrafts,
  onToggleHideDrafts,
  onToggleSectionMenu,
  onToggleSectionFilter,
  onSetSort,
  onSetFilter,
  groupByRepo,
  onToggleGroupByRepo,
  dimViewed,
  viewedMap,
  stalePreferences,
  openMenuKey,
  onViewed,
  onToggleMenu,
  onCloseMenu,
  onMarkStale,
  onMarkActive,
  onClearStalePreference,
  onClearFilters,
  filterBar,
  showLineChanges,
  showLabels,
}: {
  title: string;
  sectionKey: SectionKey;
  sectionKind: "active" | "stale";
  prs: PullRequest[];
  isOpen: boolean;
  onToggleOpen: () => void;
  emptyConnectedMessage: string;
  emptyDisconnectedMessage: string;
  isLoading: boolean;
  hasCredentials: boolean;
  statusLabel?: string;
  openSectionMenuKey: SectionKey | null;
  openSectionFilterKey: SectionKey | null;
  sortPreference: SortPreference;
  filterPreference: SectionFilterState;
  unfilteredPrs: PullRequest[];
  hideAuthorFilter?: boolean;
  hideDrafts: boolean;
  onToggleHideDrafts: () => void;
  onToggleSectionMenu: (key: SectionKey) => void;
  onToggleSectionFilter: (key: SectionKey) => void;
  onSetSort: (key: SectionKey, sort: SortPreference) => void;
  onSetFilter: (key: SectionKey, filter: SectionFilterState) => void;
  groupByRepo: boolean;
  onToggleGroupByRepo: () => void;
  dimViewed: boolean;
  viewedMap: Record<string, number>;
  stalePreferences: Record<string, StalePreference>;
  openMenuKey: string | null;
  onViewed: (repository: string, number: number) => void;
  onToggleMenu: (menuKey: string) => void;
  onCloseMenu: () => void;
  onMarkStale: (repository: string, number: number) => void;
  onMarkActive: (repository: string, number: number) => void;
  onClearStalePreference: (repository: string, number: number) => void;
  onClearFilters?: () => void;
  filterBar?: React.ReactNode;
  showLineChanges: boolean;
  showLabels: boolean;
  token: string;
}) {
  const grouped = useMemo(
    () => (groupByRepo ? groupPrsByRepo(prs) : null),
    [groupByRepo, prs],
  );

  function renderPrRow(pr: PullRequest) {
    return (
      <PullRequestRow
        key={pr.id}
        pr={pr}
        token={token}
        isViewed={
          dimViewed &&
          Boolean(viewedMap[prViewKey(pr.repository, pr.number)])
        }
        onViewed={onViewed}
        sectionKind={sectionKind}
        openMenuKey={openMenuKey}
        onToggleMenu={onToggleMenu}
        onCloseMenu={onCloseMenu}
        stalePreference={stalePreferences[prViewKey(pr.repository, pr.number)]}
        onMarkStale={onMarkStale}
        onMarkActive={onMarkActive}
        onClearStalePreference={onClearStalePreference}
        showLineChanges={showLineChanges}
        showLabels={showLabels}
      />
    );
  }

  return (
    <section className="section-card">
      <SectionHeader
        title={title}
        sectionKey={sectionKey}
        count={prs.length}
        unfilteredCount={unfilteredPrs.length}
        statusLabel={statusLabel}
        openSectionMenuKey={openSectionMenuKey}
        openSectionFilterKey={openSectionFilterKey}
        sortPreference={sortPreference}
        filterPreference={filterPreference}
        unfilteredPrs={unfilteredPrs}
        hideAuthorFilter={hideAuthorFilter}
        isOpen={isOpen}
        onToggleOpen={onToggleOpen}
        hideDrafts={hideDrafts}
        onToggleHideDrafts={onToggleHideDrafts}
        groupByRepo={groupByRepo}
        onToggleGroupByRepo={onToggleGroupByRepo}
        onToggleSectionMenu={onToggleSectionMenu}
        onToggleSectionFilter={onToggleSectionFilter}
        onSetSort={onSetSort}
        onSetFilter={onSetFilter}
      />
      {isOpen && filterBar ? filterBar : null}
      {isOpen ? (
        <div>
          {!isLoading && hasCredentials && prs.length === 0 && unfilteredPrs.length > 0 ? (
            <p className="empty-state empty-state-filtered">
              No PRs match current filters ·{" "}
              <button type="button" className="filter-clear-inline" onClick={onClearFilters}>
                Clear filters
              </button>
            </p>
          ) : !isLoading && hasCredentials && prs.length === 0 ? (
            <p className="empty-state">{emptyConnectedMessage}</p>
          ) : null}
          {!isLoading && !hasCredentials ? (
            <p className="empty-state">{emptyDisconnectedMessage}</p>
          ) : null}
          {grouped
            ? grouped.map(([repo, repoPrs]) => (
                <div key={repo} className="repo-group">
                  <div className="repo-group-header">{repo}</div>
                  {repoPrs.map(renderPrRow)}
                </div>
              ))
            : prs.map(renderPrRow)}
        </div>
      ) : null}
    </section>
  );
}
