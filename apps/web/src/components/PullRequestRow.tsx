import { useState } from 'react';
import { prViewKey, fetchPRCheckStatuses } from "@reviewradar/core";
import type { CheckStatus, PullRequest, StalePreference } from "@reviewradar/core";
import { CheckDetailsPanel } from './CheckDetailsPanel';

function getContrastColor(hexColor: string): string {
  const r = parseInt(hexColor.slice(0, 2), 16);
  const g = parseInt(hexColor.slice(2, 4), 16);
  const b = parseInt(hexColor.slice(4, 6), 16);
  // W3C relative luminance formula
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? "#000000" : "#ffffff";
}

export function PullRequestRow({
  pr,
  token,
  isViewed,
  onViewed,
  stalePreference,
  sectionKind,
  openMenuKey,
  onToggleMenu,
  onCloseMenu,
  onMarkStale,
  onMarkActive,
  onClearStalePreference,
  showLineChanges,
  showLabels,
}: {
  pr: PullRequest;
  token: string;
  isViewed: boolean;
  onViewed: (repository: string, number: number) => void;
  stalePreference?: StalePreference;
  sectionKind: "active" | "stale";
  openMenuKey: string | null;
  onToggleMenu: (menuKey: string) => void;
  onCloseMenu: () => void;
  onMarkStale: (repository: string, number: number) => void;
  onMarkActive: (repository: string, number: number) => void;
  onClearStalePreference: (repository: string, number: number) => void;
  showLineChanges: boolean;
  showLabels: boolean;
}) {
  const checkTitle =
    pr.checkState === "success"
      ? "Checks passed"
      : pr.checkState === "failure"
        ? "Checks failing"
        : "Checks pending";

  const policyTitle = pr.policyBotStatus
    ? pr.policyBotStatus.state === "success"
      ? "Policy: approved"
      : pr.policyBotStatus.state === "failure"
        ? "Policy: not satisfied"
        : "Policy: pending"
    : undefined;

  const menuKey = prViewKey(pr.repository, pr.number);
  const isMenuOpen = openMenuKey === menuKey;
  const [isExpanded, setIsExpanded] = useState(false);
  const [checkStatuses, setCheckStatuses] = useState<CheckStatus[] | null>(null);
  const [isLoadingChecks, setIsLoadingChecks] = useState(false);
  const [checksError, setChecksError] = useState<string | null>(null);

  function handleViewed(): void {
    onViewed(pr.repository, pr.number);
  }

  function handleRowClick(): void {
    const nextExpanded = !isExpanded;
    setIsExpanded(nextExpanded);
    if (nextExpanded && checkStatuses === null) {
      setIsLoadingChecks(true);
      setChecksError(null);
      fetchPRCheckStatuses(pr.repository, pr.number, token)
        .then((statuses) => { setCheckStatuses(statuses); })
        .catch((error: unknown) => {
          setChecksError(error instanceof Error ? error.message : 'Failed to load check details.');
        })
        .finally(() => { setIsLoadingChecks(false); });
    }
  }

  return (
    <article data-testid="pr-row" className={`pr-row${isViewed ? " viewed" : ""}`} onClick={handleRowClick}>
      <div className="title-group">
        <a
          href={pr.authorProfileUrl}
          className="avatar-link"
          target="_blank"
          rel="noreferrer"
          title={pr.author}
          aria-label={`Open ${pr.author} profile`}
          onClick={(event) => { event.stopPropagation() }}
        >
          <img
            src={pr.authorAvatarUrl}
            className="avatar"
            alt={`${pr.author} avatar`}
          />
        </a>
        <div className="pr-title-line">
          <span
            className={`check-indicator ${pr.checkState}`}
            title={checkTitle}
            aria-label={checkTitle}
          >
            {pr.checkState === "success" ? (
              <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06l2.47 2.47 5.97-5.97a.75.75 0 0 1 1.06 0Z" />
              </svg>
            ) : pr.checkState === "failure" ? (
              <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 1 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                <circle cx="8" cy="8" r="3.5" />
              </svg>
            )}
          </span>
          <a
            href={pr.url}
            className="pr-title"
            data-testid="pr-title-link"
            target="_blank"
            rel="noreferrer"
            onClick={(event) => { event.stopPropagation(); handleViewed() }}
          >
            {pr.isDraft ? "[Draft] " : ""}
            {pr.title}
          </a>
        </div>
        <div className="pr-detail">
          <p className="pr-meta">
            #{pr.number} opened by{" "}
            <a
              href={pr.authorProfileUrl}
              className="meta-link"
              target="_blank"
              rel="noreferrer"
              onClick={(event) => { event.stopPropagation() }}
            >
              {pr.author}
            </a>{" "}
            in{" "}
            <a
              href={pr.repositoryUrl}
              className="meta-link"
              target="_blank"
              rel="noreferrer"
              onClick={(event) => { event.stopPropagation() }}
            >
              {pr.repository}
            </a>
          </p>
          {pr.requestedReviewers.length > 0 ? (
            <div className="reviewer-list" aria-label="Requested reviewers">
              {pr.requestedReviewers.map((reviewer) => (
                <a
                  key={reviewer.login}
                  href={reviewer.profileUrl}
                  className="avatar-link reviewer-avatar-link"
                  target="_blank"
                  rel="noreferrer"
                  title={reviewer.login}
                  aria-label={`Open ${reviewer.login} profile`}
                  onClick={(event) => { event.stopPropagation() }}
                >
                  <img
                    src={reviewer.avatarUrl}
                    className="avatar reviewer-avatar"
                    alt={`${reviewer.login} avatar`}
                  />
                </a>
              ))}
            </div>
          ) : null}
          {showLabels && pr.labels && pr.labels.length > 0 ? (
            <div className="label-list">
              {pr.labels.map((label) => (
                <span
                  key={label.name}
                  className="pr-label"
                  style={{
                    backgroundColor: `#${label.color}`,
                    color: getContrastColor(label.color),
                  }}
                >
                  {label.name}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="status-group">
        {showLineChanges && pr.additions !== undefined ? (
          <span className="line-changes">
            <span className="line-additions">+{pr.additions}</span>
            <span className="line-deletions">-{pr.deletions ?? 0}</span>
          </span>
        ) : null}
        <div className="status-detail">
          {pr.policyBotStatus ? (
            <a
              href={pr.policyBotStatus.url ?? undefined}
              className={`policy-indicator ${pr.policyBotStatus.state}`}
              title={policyTitle}
              aria-label={policyTitle}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => { event.stopPropagation() }}
            >
              <span className="sr-only">{policyTitle}</span>
              <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                <path d="M8 0L1 3v4.5c0 3.88 2.98 7.5 7 8.5 4.02-1 7-4.62 7-8.5V3L8 0Zm0 1.33 5.5 2.36v3.81c0 3.22-2.42 6.25-5.5 7.17-3.08-.92-5.5-3.95-5.5-7.17V3.69L8 1.33Z" />
              </svg>
            </a>
          ) : null}
          {pr.stateLabel ? (
            <span className="pill-wrap">
              <span className={`pill ${pr.stateClass}`}>{pr.stateLabel}</span>
              <span className="pill-tooltip" role="tooltip">
                {pr.reason}
              </span>
            </span>
          ) : null}
          {import.meta.env.VITE_REVIEW_ENABLED !== 'false' && (
            <a
              href={`/review/${pr.repository}/${pr.number}`}
              className="review-link"
              onClick={(event) => { event.stopPropagation(); }}
              title="Open AI review"
              aria-label="Open AI review"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
                <path fill="currentColor" d="M1.679 7.932c.412-.621 1.242-1.75 2.366-2.717C5.175 4.242 6.527 3.5 8 3.5c1.473 0 2.825.742 3.955 1.715 1.124.967 1.954 2.096 2.366 2.717a.12.12 0 0 1 0 .136c-.412.621-1.242 1.75-2.366 2.717C10.825 11.758 9.473 12.5 8 12.5c-1.473 0-2.825-.742-3.955-1.715C2.921 9.818 2.091 8.69 1.679 8.068a.12.12 0 0 1 0-.136ZM8 2c-1.981 0-3.67.992-4.933 2.078C1.786 5.164.897 6.38.451 7.05a1.007 1.007 0 0 0 0 1.09c.446.67 1.335 1.886 2.616 2.972C4.33 12.008 6.019 13 8 13s3.67-.992 4.933-2.078c1.281-1.086 2.17-2.302 2.616-2.972a1.007 1.007 0 0 0 0-1.09c-.446-.67-1.335-1.886-2.616-2.972C11.67 2.992 9.981 2 8 2Zm0 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
              </svg>
            </a>
          )}
          <span className="updated-at">{pr.updatedAt}</span>
        </div>
      </div>
      <div className="row-menu-wrap">
        <button
          type="button"
          className="row-menu-toggle"
          aria-label="Open row actions"
          aria-expanded={isMenuOpen}
          onClick={(event) => {
            event.stopPropagation();
            onToggleMenu(menuKey);
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
            <path d="M8 3a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Zm0 6.5A1.5 1.5 0 1 1 8 6.5a1.5 1.5 0 0 1 0 3Zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z" />
          </svg>
        </button>

        {isMenuOpen ? (
          <div
            className="row-menu"
            onClick={(event) => event.stopPropagation()}
          >
            {sectionKind === "stale" ? (
              <>
                <span className="row-menu-hint">
                  {pr.staleState === "manual"
                    ? "Manually stale"
                    : "Auto stale (30d+)"}
                </span>
                <button
                  type="button"
                  className="row-menu-item"
                  onClick={() => {
                    onMarkActive(pr.repository, pr.number);
                    onCloseMenu();
                  }}
                >
                  Not stale
                </button>
              </>
            ) : stalePreference === "active" ? (
              <button
                type="button"
                className="row-menu-item"
                onClick={() => {
                  onClearStalePreference(pr.repository, pr.number);
                  onCloseMenu();
                }}
              >
                Use auto rule
              </button>
            ) : (
              <button
                type="button"
                className="row-menu-item danger-item"
                onClick={() => {
                  onMarkStale(pr.repository, pr.number);
                  onCloseMenu();
                }}
              >
                Mark stale
              </button>
            )}
            <a
              href={pr.url}
              className="row-menu-item"
              target="_blank"
              rel="noreferrer"
              onClick={() => onCloseMenu()}
            >
              Open PR
            </a>
            <a
              href={pr.repositoryUrl}
              className="row-menu-item"
              target="_blank"
              rel="noreferrer"
              onClick={() => onCloseMenu()}
            >
              Open repo
            </a>
          </div>
        ) : null}
      </div>
      {isExpanded ? <CheckDetailsPanel checkStatuses={checkStatuses ?? []} isLoading={isLoadingChecks} error={checksError} /> : null}
    </article>
  );
}
