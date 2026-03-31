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

export const CACHE_SCHEMA_VERSION = 5
export const CACHE_REVALIDATION_TTL_MS = 5 * 60 * 1000
export const CACHE_MAX_AGE_MS = 60 * 60 * 1000
export const PR_CACHE_STORAGE_KEY = 'review-radar.prCache'

type CachedPRData = {
  version: number
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

function readCacheEntry(): CachedPRData | null {
  try {
    const raw = globalThis.localStorage?.getItem(PR_CACHE_STORAGE_KEY)
    if (!raw) {
      return null
    }

    const parsed = JSON.parse(raw) as Partial<CachedPRData>
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.version !== 'number' ||
      typeof parsed.timestamp !== 'number' ||
      typeof parsed.org !== 'string' ||
      typeof parsed.data !== 'object' ||
      parsed.data === null
    ) {
      return null
    }

    return parsed as CachedPRData
  } catch {
    return null
  }
}

function isValidForOrg(entry: CachedPRData | null, org: string): entry is CachedPRData {
  return entry !== null && entry.version === CACHE_SCHEMA_VERSION && entry.org === org
}

export function readCachedPRData(org: string): CachedPRData['data'] | null {
  const entry = readCacheEntry()
  if (!isValidForOrg(entry, org)) {
    return null
  }

  if (Date.now() - entry.timestamp > CACHE_MAX_AGE_MS) {
    return null
  }

  return entry.data
}

export function isCacheStale(org: string): boolean {
  const entry = readCacheEntry()
  if (!isValidForOrg(entry, org)) {
    return true
  }

  return Date.now() - entry.timestamp > CACHE_REVALIDATION_TTL_MS
}

export function writeCachedPRData(org: string, data: CachedPRData['data']): void {
  const payload: CachedPRData = {
    version: CACHE_SCHEMA_VERSION,
    timestamp: Date.now(),
    org,
    data,
  }

  try {
    globalThis.localStorage?.setItem(PR_CACHE_STORAGE_KEY, JSON.stringify(payload))
  } catch {
    return
  }
}

export function invalidatePRCache(): void {
  try {
    globalThis.localStorage?.removeItem(PR_CACHE_STORAGE_KEY)
  } catch {
    return
  }
}

export function getCacheTimestamp(org: string): number | null {
  const entry = readCacheEntry()
  if (!isValidForOrg(entry, org)) {
    return null
  }

  return entry.timestamp
}
