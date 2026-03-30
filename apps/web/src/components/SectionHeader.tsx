import type { SectionFilterState, SectionKey, SortPreference } from "../types";
import type { PullRequest } from "../lib/classification";
import { FilterMenu } from "./FilterMenu";

export function SectionHeader({
  title,
  sectionKey,
  count,
  unfilteredCount,
  statusLabel,
  openSectionMenuKey,
  openSectionFilterKey,
  sortPreference,
  filterPreference,
  unfilteredPrs,
  hideAuthorFilter,
  isOpen,
  onToggleOpen,
  hideDrafts,
  onToggleHideDrafts,
  onToggleSectionMenu,
  onToggleSectionFilter,
  onSetSort,
  onSetFilter,
}: {
  title: string;
  sectionKey: SectionKey;
  count: number;
  unfilteredCount: number;
  statusLabel?: string;
  openSectionMenuKey: SectionKey | null;
  openSectionFilterKey: SectionKey | null;
  sortPreference: SortPreference;
  filterPreference: SectionFilterState;
  onSetFilter: (key: SectionKey, filter: SectionFilterState) => void;
  unfilteredPrs: PullRequest[];
  hideAuthorFilter?: boolean;
  isOpen: boolean;
  onToggleOpen: () => void;
  hideDrafts: boolean;
  onToggleHideDrafts: () => void;
  onToggleSectionMenu: (key: SectionKey) => void;
  onToggleSectionFilter: (key: SectionKey) => void;
  onSetSort: (key: SectionKey, sort: SortPreference) => void;
}) {
  const isMenuOpen = openSectionMenuKey === sectionKey;
  const isFilterMenuOpen = openSectionFilterKey === sectionKey;
  const isFilterActive =
    filterPreference.repository.size > 0 ||
    filterPreference.checkStatus.size > 0 ||
    filterPreference.labels.size > 0 ||
    filterPreference.author.size > 0;

  return (
    <div className="section-header">
      <button
        type="button"
        className="section-title-toggle"
        onClick={onToggleOpen}
        aria-expanded={isOpen}
      >
        <svg
          className={`section-chevron${isOpen ? "" : " section-chevron--collapsed"}`}
          viewBox="0 0 16 16"
          width="14"
          height="14"
          aria-hidden="true"
          role="presentation"
        >
          <path
            d="M4.5 6L8 9.5 11.5 6"
            stroke="currentColor"
            strokeWidth="1.5"
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="section-title-text">{title}</span>
      </button>
      <div className="section-header-tools">
        <span>
          {count}
          {isFilterActive && unfilteredCount > count ? (
            <span className="section-count-detail"> of {unfilteredCount}</span>
          ) : null}
        </span>
        {statusLabel ? (
          <span className="section-status-label">{statusLabel}</span>
        ) : null}
        <span className="section-count-detail"> · </span>
        <label className="draft-toggle">
          <input
            type="checkbox"
            className="draft-toggle-input"
            checked={!hideDrafts}
            onClick={(event) => event.stopPropagation()}
            onChange={() => onToggleHideDrafts()}
          />
          <span className="draft-toggle-track">
            <span className="draft-toggle-knob" />
          </span>
          Show drafts
        </label>
        <span className="section-count-detail"> · </span>
         <div className="filter-menu-wrap">
           <button
             type="button"
             className={`filter-menu-toggle${isFilterActive ? " filter-active" : ""}`}
             aria-label="Filter options"
            aria-expanded={isFilterMenuOpen}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSectionFilter(sectionKey);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
              <path
                d="M1.5 2.5h13l-5 5.5v4l-3 2v-6L1.5 2.5z"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          {isFilterMenuOpen ? (
            <FilterMenu
              prs={unfilteredPrs}
              filter={filterPreference}
              onSetFilter={(f) => onSetFilter(sectionKey, f)}
              hideAuthor={hideAuthorFilter}
            />
          ) : null}
        </div>
        <div className="section-menu-wrap">
          <button
            type="button"
            className="section-menu-toggle"
            aria-label="Sort options"
            aria-expanded={isMenuOpen}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSectionMenu(sectionKey);
            }}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
              <path d="M2 3.5h8M2 8h5.5M2 12.5h3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
              <path d="M12 4v8m0 0l-2-2m2 2l2-2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
            </svg>
          </button>
          {isMenuOpen ? (
            <div className="section-menu">
              <span className="row-menu-hint">Sort By</span>
              <button
                type="button"
                className={`row-menu-item${sortPreference === "oldest-first" ? " active-sort" : ""}`}
                onClick={() => onSetSort(sectionKey, "oldest-first")}
              >
                {sortPreference === "oldest-first" ? "\u2713 " : ""}Oldest first
              </button>
              <button
                type="button"
                className={`row-menu-item${sortPreference === "newest-first" ? " active-sort" : ""}`}
                onClick={() => onSetSort(sectionKey, "newest-first")}
              >
                {sortPreference === "newest-first" ? "\u2713 " : ""}Newest first
              </button>
               <button
                 type="button"
                 className={`row-menu-item${sortPreference === "default" ? " active-sort" : ""}`}
                 onClick={() => onSetSort(sectionKey, "default")}
               >
                 {sortPreference === "default" ? "\u2713 " : ""}Last updated
               </button>
               <div className="section-menu-divider" />
                {sectionKey !== "yourPrs" ? (
                  <button
                    type="button"
                    className={`row-menu-item${sortPreference === "author-az" ? " active-sort" : ""}`}
                    onClick={() => onSetSort(sectionKey, "author-az")}
                  >
                    {sortPreference === "author-az" ? "\u2713 " : ""}Author (A–Z)
                  </button>
                ) : null}
               <button
                 type="button"
                 className={`row-menu-item${sortPreference === "repo-az" ? " active-sort" : ""}`}
                 onClick={() => onSetSort(sectionKey, "repo-az")}
               >
                 {sortPreference === "repo-az" ? "\u2713 " : ""}Repository (A–Z)
               </button>
               <button
                 type="button"
                 className={`row-menu-item${sortPreference === "line-changes-desc" ? " active-sort" : ""}`}
                 onClick={() => onSetSort(sectionKey, "line-changes-desc")}
               >
                 {sortPreference === "line-changes-desc" ? "\u2713 " : ""}Most changed
               </button>
             </div>
           ) : null}
        </div>
      </div>
    </div>
  );
}
