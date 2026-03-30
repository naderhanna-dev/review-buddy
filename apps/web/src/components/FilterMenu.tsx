import { EMPTY_FILTER_STATE } from "@reviewradar/core";
import type { PullRequest, SectionFilterState } from "@reviewradar/core";

type Props = {
  prs: PullRequest[];
  filter: SectionFilterState;
  onSetFilter: (filter: SectionFilterState) => void;
  hideAuthor?: boolean;
};

function shortRepo(fullName: string): string {
  const slash = fullName.indexOf("/");
  return slash >= 0 ? fullName.substring(slash + 1) : fullName;
}

export function FilterMenu({ prs, filter, onSetFilter, hideAuthor = false }: Props) {
  // Compute dynamic options from the pre-filter PR list
  const repoCounts = new Map<string, number>();
  for (const pr of prs) {
    if (pr.repository) {
      repoCounts.set(pr.repository, (repoCounts.get(pr.repository) ?? 0) + 1);
    }
  }
  const repos = [...repoCounts.keys()].sort();

  const authorCounts = new Map<string, number>();
  for (const pr of prs) {
    if (pr.author) {
      authorCounts.set(pr.author, (authorCounts.get(pr.author) ?? 0) + 1);
    }
  }
  const authors = [...authorCounts.keys()].sort();

  const allLabels = new Map<string, string>();
  const labelCounts = new Map<string, number>();
  for (const pr of prs) {
    for (const label of pr.labels ?? []) {
      if (!allLabels.has(label.name)) {
        allLabels.set(label.name, label.color);
      }
      labelCounts.set(label.name, (labelCounts.get(label.name) ?? 0) + 1);
    }
  }
  const sortedLabels = [...allLabels.entries()].sort(([a], [b]) => a.localeCompare(b));

  const checkStatusCounts = new Map<string, number>();
  for (const pr of prs) {
    checkStatusCounts.set(pr.checkState, (checkStatusCounts.get(pr.checkState) ?? 0) + 1);
  }

  function toggle(
    dimension: keyof SectionFilterState,
    value: string,
  ): void {
    const current = filter[dimension];
    const next = new Set(current);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onSetFilter({ ...filter, [dimension]: next });
  }

  const isAnyActive =
    filter.repository.size > 0 ||
    filter.checkStatus.size > 0 ||
    filter.labels.size > 0 ||
    filter.author.size > 0;

  const CHECK_STATUS_OPTIONS: Array<{ value: string; label: string; colorVar: string }> = [
    { value: "success", label: "Passing", colorVar: "var(--check-success)" },
    { value: "pending", label: "Pending", colorVar: "var(--check-pending)" },
    { value: "failure", label: "Failing", colorVar: "var(--check-failure)" },
  ];

  return (
    <div className="filter-menu" role="menu" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <div className="filter-menu-scroll">
        {repos.length > 0 && (
          <div className="filter-dimension">
            <span className="row-menu-hint">Repository</span>
            {repos.map((repo) => (
              <label key={repo} className="filter-option">
                <input
                  type="checkbox"
                  checked={filter.repository.has(repo)}
                  onChange={() => toggle("repository", repo)}
                />
                <span className="filter-option-label">{shortRepo(repo)} <span className="filter-option-count">({repoCounts.get(repo)})</span></span>
              </label>
            ))}
          </div>
        )}
        <div className="filter-dimension">
          <span className="row-menu-hint">Check status</span>
          {CHECK_STATUS_OPTIONS.map(({ value, label, colorVar }) => (
            <label key={value} className="filter-option">
              <input
                type="checkbox"
                checked={filter.checkStatus.has(value)}
                onChange={() => toggle("checkStatus", value)}
              />
              <span className="filter-status-dot" style={{ backgroundColor: colorVar }} />
              <span className="filter-option-label">{label} <span className="filter-option-count">({checkStatusCounts.get(value) ?? 0})</span></span>
            </label>
          ))}
        </div>
        {sortedLabels.length > 0 && (
          <div className="filter-dimension">
            <span className="row-menu-hint">Labels</span>
            {sortedLabels.map(([name, color]) => (
              <label key={name} className="filter-option">
                <input
                  type="checkbox"
                  checked={filter.labels.has(name)}
                  onChange={() => toggle("labels", name)}
                />
                <span
                  className="filter-label-swatch"
                  style={{ backgroundColor: `#${color}` }}
                />
                <span className="filter-option-label">{name} <span className="filter-option-count">({labelCounts.get(name)})</span></span>
              </label>
            ))}
          </div>
        )}
        {!hideAuthor && authors.length > 0 && (
          <div className="filter-dimension">
            <span className="row-menu-hint">Author</span>
            {authors.map((author) => (
              <label key={author} className="filter-option">
                <input
                  type="checkbox"
                  checked={filter.author.has(author)}
                  onChange={() => toggle("author", author)}
                />
                <span className="filter-option-label">{author} <span className="filter-option-count">({authorCounts.get(author)})</span></span>
              </label>
            ))}
          </div>
        )}
      </div>
      {isAnyActive && (
        <button
          type="button"
          className="filter-clear-btn"
          onClick={() => onSetFilter(EMPTY_FILTER_STATE)}
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}
