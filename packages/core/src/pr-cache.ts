import type { PullRequest } from './classification'

// Mirrors MergedPullRequest from App.tsx — duplicated to avoid circular dependency
type CachedMergedPR = {
  id: number
  number: number
  title: string
  repository: string
  repositoryUrl: string
  author: string
  authorAvatarUrl: string
  authorProfileUrl: string
  url: string
  mergedAt: string
  mergedAtIso: string
  role: 'author' | 'reviewed'
}

export const CACHE_SCHEMA_VERSION = 6
export const CACHE_REVALIDATION_TTL_MS = 5 * 60 * 1000
export const CACHE_MAX_AGE_MS = 60 * 60 * 1000
export const PR_CACHE_STORAGE_KEY = 'review-radar.prCache'

type CachedOrgEntry = {
  timestamp: number
  org: string
  data: {
    yourPrs: PullRequest[]
    needsAttention: PullRequest[]
    relatedToYou: PullRequest[]
    stalePrs: PullRequest[]
    recentlyMerged: CachedMergedPR[]
    teamSignalsUnavailable: string | null
  }
}

type CachedMultiOrgPRData = {
  version: number
  entries: Record<string, CachedOrgEntry>
}

// Legacy single-org format (version <= 5) for migration
type LegacyCachedPRData = {
  version: number
  timestamp: number
  org: string
  data: CachedOrgEntry['data']
}

function readCacheStore(): CachedMultiOrgPRData | null {
  try {
    const raw = globalThis.localStorage?.getItem(PR_CACHE_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (typeof parsed !== 'object' || parsed === null || typeof parsed.version !== 'number') {
      return null
    }

    // Multi-org format (version 6+)
    if (parsed.version === CACHE_SCHEMA_VERSION && typeof parsed.entries === 'object' && parsed.entries !== null) {
      return parsed as unknown as CachedMultiOrgPRData
    }

    // Legacy single-org format: migrate on read
    const legacy = parsed as unknown as Partial<LegacyCachedPRData>
    if (
      typeof legacy.timestamp === 'number' &&
      typeof legacy.org === 'string' &&
      typeof legacy.data === 'object' &&
      legacy.data !== null
    ) {
      // We can't generate a stable orgId here, so use the org name as a fallback key.
      // The first fetchAllOrgs call will overwrite with the real orgId.
      const migrated: CachedMultiOrgPRData = {
        version: CACHE_SCHEMA_VERSION,
        entries: {
          [`legacy-${legacy.org}`]: {
            timestamp: legacy.timestamp,
            org: legacy.org,
            data: legacy.data as CachedOrgEntry['data'],
          },
        },
      }
      return migrated
    }

    return null
  } catch {
    return null
  }
}

function getEntry(orgId: string): CachedOrgEntry | null {
  const store = readCacheStore()
  if (!store) {
    return null
  }
  return store.entries[orgId] ?? null
}

export function readCachedPRData(orgId: string): CachedOrgEntry['data'] | null {
  const entry = getEntry(orgId)
  if (!entry) {
    return null
  }

  if (Date.now() - entry.timestamp > CACHE_MAX_AGE_MS) {
    return null
  }

  return entry.data
}

export function isCacheStale(orgId: string): boolean {
  const entry = getEntry(orgId)
  if (!entry) {
    return true
  }

  return Date.now() - entry.timestamp > CACHE_REVALIDATION_TTL_MS
}

export function writeCachedPRData(orgId: string, org: string, data: CachedOrgEntry['data']): void {
  try {
    const store = readCacheStore() ?? { version: CACHE_SCHEMA_VERSION, entries: {} }
    store.version = CACHE_SCHEMA_VERSION
    store.entries[orgId] = {
      timestamp: Date.now(),
      org,
      data,
    }
    globalThis.localStorage?.setItem(PR_CACHE_STORAGE_KEY, JSON.stringify(store))
  } catch {
    return
  }
}

export function invalidatePRCache(orgId?: string): void {
  try {
    if (!orgId) {
      globalThis.localStorage?.removeItem(PR_CACHE_STORAGE_KEY)
      return
    }

    const store = readCacheStore()
    if (!store) {
      return
    }
    delete store.entries[orgId]
    globalThis.localStorage?.setItem(PR_CACHE_STORAGE_KEY, JSON.stringify(store))
  } catch {
    return
  }
}

export function getCacheTimestamp(orgId: string): number | null {
  const entry = getEntry(orgId)
  if (!entry) {
    return null
  }

  return entry.timestamp
}

/**
 * Returns the oldest cache timestamp across all org entries,
 * or null if no entries are cached.
 */
export function getOldestCacheTimestamp(): number | null {
  const store = readCacheStore()
  if (!store) {
    return null
  }

  let oldest: number | null = null
  for (const entry of Object.values(store.entries)) {
    if (oldest === null || entry.timestamp < oldest) {
      oldest = entry.timestamp
    }
  }
  return oldest
}

/**
 * Returns true if any org's cache is stale (or missing).
 */
export function isAnyCacheStale(orgIds: string[]): boolean {
  for (const orgId of orgIds) {
    if (isCacheStale(orgId)) {
      return true
    }
  }
  return orgIds.length === 0
}
