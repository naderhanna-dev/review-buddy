import type { SectionKey, SortPreference } from "../types";

export function SectionHeader({
  title,
  sectionKey,
  count,
  updatedCount,
  statusLabel,
  openSectionMenuKey,
  sortPreference,
  isOpen,
  onToggleOpen,
  hideDrafts,
  onToggleHideDrafts,
  onToggleSectionMenu,
  onSetSort,
}: {
  title: string;
  sectionKey: SectionKey;
  count: number;
  updatedCount?: number;
  statusLabel?: string;
  openSectionMenuKey: SectionKey | null;
  sortPreference: SortPreference;
  isOpen: boolean;
  onToggleOpen: () => void;
  hideDrafts: boolean;
  onToggleHideDrafts: () => void;
  onToggleSectionMenu: (key: SectionKey) => void;
  onSetSort: (key: SectionKey, sort: SortPreference) => void;
}) {
  const isMenuOpen = openSectionMenuKey === sectionKey;

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
          {updatedCount != null && updatedCount > 0 ? (
            <span className="section-count-detail">
              {" "}
              · {updatedCount} updated
            </span>
          ) : null}
        </span>
        {statusLabel ? (
          <span className="section-status-label">{statusLabel}</span>
        ) : null}
        <span className="section-count-detail"> · </span>
        <label className="draft-toggle" onClick={(event) => event.stopPropagation()}>
          <input
            type="checkbox"
            className="draft-toggle-input"
            checked={!hideDrafts}
            onChange={() => onToggleHideDrafts()}
          />
          <span className="draft-toggle-track">
            <span className="draft-toggle-knob" />
          </span>
          Show drafts
        </label>
        <span className="section-count-detail"> · </span>
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
            <div
              className="section-menu"
              onClick={(event) => event.stopPropagation()}
            >
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
