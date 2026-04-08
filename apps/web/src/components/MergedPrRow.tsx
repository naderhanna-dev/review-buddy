import type { MergedPullRequest } from "@reviewradar/core";

export function MergedPrRow({ pr }: { pr: MergedPullRequest }) {
  return (
    <article className="pr-row">
      <div className="title-group">
        <a
          href={pr.authorProfileUrl}
          className="avatar-link"
          target="_blank"
          rel="noreferrer"
          title={pr.author}
          aria-label={`Open ${pr.author} profile`}
        >
          <img
            src={pr.authorAvatarUrl}
            className="avatar"
            alt={`${pr.author} avatar`}
          />
        </a>
        <div className="pr-title-line">
          <span className="check-indicator success">
            <svg viewBox="0 0 16 16" aria-hidden="true" role="presentation">
              <path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm3.78-9.72a.75.75 0 0 0-1.06-1.06L7.25 8.69 5.28 6.72a.75.75 0 0 0-1.06 1.06l2.5 2.5a.75.75 0 0 0 1.06 0l4-4Z" />
            </svg>
          </span>
          <a
            href={pr.url}
            className="pr-title"
            target="_blank"
            rel="noreferrer"
          >
            {pr.title}
          </a>
        </div>
        <div className="pr-detail">
          <p className="pr-meta">
            #{pr.number} by{" "}
            <a
              href={pr.authorProfileUrl}
              className="meta-link"
              target="_blank"
              rel="noreferrer"
            >
              {pr.author}
            </a>{" "}
            in{" "}
            <a
              href={pr.repositoryUrl}
              className="meta-link"
              target="_blank"
              rel="noreferrer"
            >
              {pr.repository}
            </a>
          </p>
        </div>
      </div>
      <div className="status-group">
        <div className="status-detail">
          <span className="pill-wrap">
            <span
              className={`pill merged-pill ${pr.role === "author" ? "merged-author" : "merged-reviewed"}`}
            >
              {pr.role === "author" ? "Author" : "Reviewed"}
            </span>
          </span>
          <span className="updated-at">Merged {pr.mergedAt}</span>
        </div>
      </div>
    </article>
  );
}
