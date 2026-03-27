import { prViewKey } from "../lib/classification";
import type { PullRequest } from "../lib/classification";
import type { SectionFilterState, SectionKey, SortPreference, StalePreference } from "../types";
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
}) {
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
          {prs.map((pr) => (
            <PullRequestRow
              key={pr.id}
              pr={pr}
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
          ))}
        </div>
      ) : null}
    </section>
  );
}
