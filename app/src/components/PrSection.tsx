import { prViewKey } from "../lib/classification";
import type { PullRequest } from "../lib/classification";
import type { SectionKey, SortPreference, StalePreference } from "../types";
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
  updatedCount,
  statusLabel,
  openSectionMenuKey,
  sortPreference,
  hideDrafts,
  onToggleHideDrafts,
  onToggleSectionMenu,
  onSetSort,
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
  updatedCount?: number;
  statusLabel?: string;
  openSectionMenuKey: SectionKey | null;
  sortPreference: SortPreference;
  hideDrafts: boolean;
  onToggleHideDrafts: () => void;
  onToggleSectionMenu: (key: SectionKey) => void;
  onSetSort: (key: SectionKey, sort: SortPreference) => void;
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
  showLineChanges: boolean;
  showLabels: boolean;
}) {
  return (
    <section className="section-card">
      <SectionHeader
        title={title}
        sectionKey={sectionKey}
        count={prs.length}
        updatedCount={updatedCount}
        statusLabel={statusLabel}
        openSectionMenuKey={openSectionMenuKey}
        sortPreference={sortPreference}
        isOpen={isOpen}
        onToggleOpen={onToggleOpen}
        hideDrafts={hideDrafts}
        onToggleHideDrafts={onToggleHideDrafts}
        onToggleSectionMenu={onToggleSectionMenu}
        onSetSort={onSetSort}
      />
      {isOpen ? (
        <div>
          {!isLoading && hasCredentials && prs.length === 0 ? (
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
