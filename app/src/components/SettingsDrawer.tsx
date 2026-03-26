import type { FormEvent } from "react";
import { MERGED_COUNT_MAX, MERGED_COUNT_MIN } from "../constants";

export function SettingsDrawer({
  org,
  hasSavedConnection,
  tokenInput,
  setTokenInput,
  orgInput,
  setOrgInput,
  onSubmit,
  mergedCountInput,
  onMergedCountChange,
  mergedCount,
  onMergedCountBlur,
  dimViewed,
  onToggleDimViewed,
  teamSignalsUnavailable,
  onClose,
}: {
  org: string;
  hasSavedConnection: boolean;
  tokenInput: string;
  setTokenInput: (value: string) => void;
  orgInput: string;
  setOrgInput: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  mergedCountInput: string;
  onMergedCountChange: (value: string) => void;
  mergedCount: number;
  onMergedCountBlur: () => void;
  dimViewed: boolean;
  onToggleDimViewed: () => void;
  teamSignalsUnavailable: string | null;
  onClose: () => void;
}) {
  return (
    <>
      <button
        type="button"
        className="settings-backdrop"
        aria-label="Close settings"
        onClick={onClose}
      />
      <aside className="settings-drawer" aria-label="Connection settings">
        <div className="settings-header">
          <h2>Settings</h2>
          <button
            type="button"
            className="settings-close"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        {hasSavedConnection ? (
          <p className="connection-summary">
            Connected to {org} with saved PAT.
          </p>
        ) : null}
        <form className="config-form" onSubmit={onSubmit}>
          <label>
            GitHub organization
            <input
              type="text"
              value={orgInput}
              onChange={(event) => setOrgInput(event.target.value)}
              placeholder="your-org"
              autoComplete="organization"
            />
          </label>
          <label>
            Personal access token
            <input
              type="password"
              value={tokenInput}
              onChange={(event) => setTokenInput(event.target.value)}
              placeholder="github_pat_..."
              autoComplete="off"
            />
          </label>
          <button type="submit">Save and refresh</button>
        </form>
        <div className="helper-copy">
          <p>PAT is stored in local storage for this browser profile.</p>
          <p>
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              Create a fine-grained PAT
            </a>{" "}
            and set <strong>Resource owner</strong> to{" "}
            <strong>MaintainX</strong> (the Resource owner cannot be changed
            after creation — if your existing token uses your personal
            account, you need to generate a new one). Then select{" "}
            <strong>All repositories</strong> and grant these permissions:
          </p>
          <ul>
            <li>Pull requests: Read (required)</li>
            <li>
              Commit statuses: Read (required for PR check status icons)
            </li>
            <li>
              Members: Read — organization permission (optional, enables
              team-assigned PR signals)
            </li>
          </ul>
          <p>
            For <strong>live refresh</strong> (~60s), use a{" "}
            <a
              href="https://github.com/settings/tokens/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              classic token
            </a>{" "}
            with <strong>repo</strong> and <strong>notifications</strong>{" "}
            scopes, then authorize it for <strong>MaintainX SSO</strong>.
            Fine-grained tokens use 2-minute polling instead (still
            efficient via ETag caching).
          </p>
        </div>
        <div className="user-preferences">
          <h3 className="user-preferences-heading">User preferences</h3>
          <div className="user-preferences-group">
            <h4 className="user-preferences-subheading">
              Recently merged count
            </h4>
            <p className="user-preferences-description">
              Number of recently merged PRs to show.
            </p>
            <input
              type="number"
              className="user-preferences-number"
              value={mergedCountInput}
              onChange={(event) => onMergedCountChange(event.target.value)}
              onBlur={onMergedCountBlur}
              min={MERGED_COUNT_MIN}
              max={MERGED_COUNT_MAX}
              autoComplete="off"
            />
          </div>
          <div className="user-preferences-group">
            <h4 className="user-preferences-subheading">Dim viewed PRs</h4>
            <label className="user-preferences-toggle">
              <span className="user-preferences-description">
                Reduce opacity of PRs you have already clicked.
              </span>
              <input
                type="checkbox"
                checked={dimViewed}
                onChange={onToggleDimViewed}
              />
            </label>
          </div>
        </div>
        {teamSignalsUnavailable ? (
          <p className="helper-copy warning-copy">
            {teamSignalsUnavailable} Showing direct-review and
            activity-based signals only.
          </p>
        ) : null}
      </aside>
    </>
  );
}
