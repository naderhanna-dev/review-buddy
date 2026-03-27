import type { PullRequest } from "../lib/classification";
import type { SectionFilterState } from "../types";
import { EMPTY_FILTER_STATE } from "../types";

type Props = {
  prs: PullRequest[];
  filter: SectionFilterState;
  onSetFilter: (filter: SectionFilterState) => void;
  hideAuthor?: boolean;
};

export function FilterMenu({ prs, filter, onSetFilter, hideAuthor = false }: Props) {
  // Compute dynamic options from the pre-filter PR list
  const repos = [...new Set(prs.map((pr) => pr.repository).filter(Boolean))].sort();
  const authors = [...new Set(prs.map((pr) => pr.author).filter(Boolean))].sort();
  const allLabels = new Map<string, string>();
  for (const pr of prs) {
    for (const label of pr.labels ?? []) {
      if (!allLabels.has(label.name)) {
        allLabels.set(label.name, label.color);
      }
    }
  }
  const sortedLabels = [...allLabels.entries()].sort(([a], [b]) => a.localeCompare(b));

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

  const CHECK_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
    { value: "success", label: "Passing" },
    { value: "pending", label: "Pending" },
    { value: "failure", label: "Failing" },
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
                <span className="filter-option-label">{repo}</span>
              </label>
            ))}
          </div>
        )}
        <div className="filter-dimension">
          <span className="row-menu-hint">Check status</span>
          {CHECK_STATUS_OPTIONS.map(({ value, label }) => (
            <label key={value} className="filter-option">
              <input
                type="checkbox"
                checked={filter.checkStatus.has(value)}
                onChange={() => toggle("checkStatus", value)}
              />
              <span className="filter-option-label">{label}</span>
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
                <span className="filter-option-label">{name}</span>
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
                <span className="filter-option-label">{author}</span>
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
