import type { CheckStatus } from '../lib/classification'

export function CheckDetailsPanel({ checkStatuses, isLoading, error }: { checkStatuses: CheckStatus[]; isLoading?: boolean; error?: string | null }) {
  return (
    <div data-testid="check-details-panel" className="check-details-panel">
      {isLoading ? (
        <p className="check-details-loading">Loading checks</p>
      ) : error ? (
        <p className="check-details-error">{error}</p>
      ) : (
        <>
          {checkStatuses.map((check, index) => (
            <div key={`${check.name}-${check.url ?? ''}-${index}`} data-testid="check-item" className="check-item">
              <span data-testid="check-item-state" className={`check-item-state ${check.state}`}>{check.state}</span>
              <span data-testid="check-item-name" className="check-item-name">{check.name}</span>
              {check.url ? <a href={check.url} target="_blank" rel="noreferrer" className="check-item-link">Details</a> : null}
            </div>
          ))}
          {checkStatuses.length === 0 ? <p className="check-details-empty">No failing checks.</p> : null}
        </>
      )}
    </div>
  )
}
