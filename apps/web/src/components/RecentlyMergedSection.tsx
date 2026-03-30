import { useState } from "react";
import type { MergedPullRequest } from "@reviewradar/core";
import { MergedPrRow } from "./MergedPrRow";

export function RecentlyMergedSection({
  recentlyMerged,
  isLoading,
  lastRefreshedAt,
  hasCredentials,
}: {
  recentlyMerged: MergedPullRequest[];
  isLoading: boolean;
  lastRefreshedAt: number | null;
  hasCredentials: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <section className="section-card">
      <div className="section-header">
        <button
          type="button"
          className="section-title-toggle"
          onClick={() => setIsOpen((current) => !current)}
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
          <span className="section-title-text">Recently merged</span>
        </button>
        <div className="section-header-tools">
          <span>{recentlyMerged.length}</span>
          {isLoading && !lastRefreshedAt ? (
            <span className="section-status-label">Loading...</span>
          ) : null}
        </div>
      </div>
      {isOpen ? (
        <div>
          {!isLoading && hasCredentials && recentlyMerged.length === 0 ? (
            <p className="empty-state">
              No recently merged pull requests found.
            </p>
          ) : null}
          {!isLoading && !hasCredentials ? (
            <p className="empty-state">
              Add org + PAT above to load pull requests from GitHub.
            </p>
          ) : null}
          {recentlyMerged.map((pr) => (
            <MergedPrRow key={pr.id} pr={pr} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
