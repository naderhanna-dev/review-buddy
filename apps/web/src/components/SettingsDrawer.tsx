import type { FormEvent } from "react";
import { MERGED_COUNT_MAX, MERGED_COUNT_MIN } from "@reviewradar/core";
import type { OrgConfig } from "@reviewradar/core";

export function SettingsDrawer({
  orgConfigs,
  orgConfigDrafts,
  onOrgDraftChange,
  onAddOrg,
  onRemoveOrg,
  onSubmit,
  mergedCountInput,
  onMergedCountChange,
  onMergedCountBlur,
  dimViewed,
  onToggleDimViewed,
  showLineChanges,
  onToggleShowLineChanges,
  showLabels,
  onToggleShowLabels,
  teamSignalsUnavailable,
  onClose,
}: {
  orgConfigs: OrgConfig[];
  orgConfigDrafts: OrgConfig[];
  onOrgDraftChange: (index: number, field: "org" | "token", value: string) => void;
  onAddOrg: () => void;
  onRemoveOrg: (index: number) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  mergedCountInput: string;
  onMergedCountChange: (value: string) => void;
  mergedCount: number;
  onMergedCountBlur: () => void;
  dimViewed: boolean;
  onToggleDimViewed: () => void;
  showLineChanges: boolean;
  onToggleShowLineChanges: () => void;
  showLabels: boolean;
  onToggleShowLabels: () => void;
  teamSignalsUnavailable: string | null;
  onClose: () => void;
}) {
  const connectedOrgs = orgConfigs.filter((c) => c.org && c.token);

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
        {connectedOrgs.length > 0 ? (
          <p className="connection-summary">
            Connected to {connectedOrgs.map((c) => c.org).join(", ")}.
          </p>
        ) : null}
        <form className="config-form config-form--multi-org" onSubmit={onSubmit}>
          <div className="org-config-list">
            {orgConfigDrafts.map((draft, index) => (
              <div key={draft.id} className={`org-config-row${orgConfigDrafts.length > 1 ? " org-config-row--removable" : ""}`}>
                <label>
                  {index === 0 ? "Organization" : <span className="sr-only">Organization</span>}
                  <input
                    type="text"
                    value={draft.org}
                    onChange={(event) => onOrgDraftChange(index, "org", event.target.value)}
                    placeholder="your-org"
                    autoComplete="organization"
                  />
                </label>
                <label>
                  {index === 0 ? "Personal access token" : <span className="sr-only">Personal access token</span>}
                  <input
                    type="password"
                    value={draft.token}
                    onChange={(event) => onOrgDraftChange(index, "token", event.target.value)}
                    placeholder="github_pat_..."
                    autoComplete="off"
                  />
                </label>
                {orgConfigDrafts.length > 1 ? (
                  <button
                    type="button"
                    className="org-remove-button"
                    aria-label={`Remove ${draft.org || "organization"}`}
                    onClick={() => onRemoveOrg(index)}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" role="presentation">
                      <path d="M18.36 5.64a1 1 0 0 1 0 1.41L13.41 12l4.95 4.95a1 1 0 1 1-1.41 1.41L12 13.41l-4.95 4.95a1 1 0 1 1-1.41-1.41L10.59 12 5.64 7.05a1 1 0 0 1 1.41-1.41L12 10.59l4.95-4.95a1 1 0 0 1 1.41 0Z" />
                    </svg>
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="org-config-actions">
            <button type="button" className="org-add-button" onClick={onAddOrg}>
              + Add organization
            </button>
            <button type="submit">Save and refresh</button>
          </div>
        </form>
        <div className="helper-copy">
          <p>PATs are stored in local storage for this browser profile.</p>
          <p>
            <a
              href="https://github.com/settings/personal-access-tokens/new"
              target="_blank"
              rel="noopener noreferrer"
            >
              Create a fine-grained PAT
            </a>{" "}
            and set <strong>Resource owner</strong> to your target
            organization (the Resource owner cannot be changed
            after creation). Then select{" "}
            <strong>All repositories</strong> and grant these permissions:
          </p>
          <ul>
            <li>Pull requests: Read (required)</li>
            <li>
              Commit statuses: Read (required for PR check status icons)
            </li>
            <li>
              Issues: Read (optional, enables PR label display)
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
            scopes, then authorize it for your org&apos;s SSO.
            Fine-grained tokens use 2-minute polling instead (still
            efficient via ETag caching).
          </p>
          <p>
            Each organization requires its own PAT with the correct
            Resource owner. Add multiple rows above to monitor
            several organizations.
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
          <div className="user-preferences-group">
            <h4 className="user-preferences-subheading">Show line changes</h4>
            <label className="user-preferences-toggle">
              <span className="user-preferences-description">
                Display additions and deletions on each PR.
              </span>
              <input
                type="checkbox"
                checked={showLineChanges}
                onChange={onToggleShowLineChanges}
              />
            </label>
          </div>
          <div className="user-preferences-group">
            <h4 className="user-preferences-subheading">Show PR labels</h4>
            <label className="user-preferences-toggle">
              <span className="user-preferences-description">
                Display GitHub labels on each PR.
              </span>
              <input
                type="checkbox"
                checked={showLabels}
                onChange={onToggleShowLabels}
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
