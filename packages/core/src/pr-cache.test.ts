import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CACHE_MAX_AGE_MS,
  CACHE_REVALIDATION_TTL_MS,
  CACHE_SCHEMA_VERSION,
  PR_CACHE_STORAGE_KEY,
  getCacheTimestamp,
  getOldestCacheTimestamp,
  invalidatePRCache,
  isAnyCacheStale,
  isCacheStale,
  readCachedPRData,
  writeCachedPRData,
} from './pr-cache'
import type { PullRequest } from './classification'

const mockStorage = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => mockStorage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockStorage.set(key, value)
  }),
  removeItem: vi.fn((key: string) => {
    mockStorage.delete(key)
  }),
  clear: vi.fn(() => {
    mockStorage.clear()
  }),
}

vi.stubGlobal('localStorage', localStorageMock)

const orgId = 'org-1'
const org = 'maintainx'
const fixedNow = 1_700_000_000_000

const samplePullRequest: PullRequest = {
  id: 1,
  number: 42,
  title: 'Improve cache behavior',
  repository: 'maintainx/review-radar',
  repositoryUrl: 'https://github.com/maintainx/review-radar',
  author: 'alice',
  authorAvatarUrl: 'https://avatars.githubusercontent.com/u/1',
  authorProfileUrl: 'https://github.com/alice',
  requestedReviewers: [
    {
      login: 'bob',
      avatarUrl: 'https://avatars.githubusercontent.com/u/2',
      profileUrl: 'https://github.com/bob',
    },
  ],
  updatedAt: 'today',
  updatedAtIso: '2026-03-25T10:00:00.000Z',
  createdAtIso: '2026-03-24T10:00:00.000Z',
  url: 'https://github.com/maintainx/review-radar/pull/42',
  checkState: 'success',
  staleState: 'auto',
  stateLabel: 'Open',
  stateClass: 'open',
  reason: 'Requested reviewer',
  isDraft: false,
}

const sampleMergedPR = {
  id: 2,
  number: 43,
  title: 'Merged PR',
  repository: 'maintainx/review-radar',
  repositoryUrl: 'https://github.com/maintainx/review-radar',
  author: 'bob',
  authorAvatarUrl: 'https://avatars.githubusercontent.com/u/3',
  authorProfileUrl: 'https://github.com/bob',
  url: 'https://github.com/maintainx/review-radar/pull/43',
  mergedAt: '2h ago',
  mergedAtIso: '2026-03-25T08:00:00.000Z',
  role: 'author' as const,
}

const sampleData = {
  yourPrs: [samplePullRequest],
  needsAttention: [samplePullRequest],
  relatedToYou: [samplePullRequest],
  stalePrs: [],
  recentlyMerged: [sampleMergedPR],
  teamSignalsUnavailable: null,
}

function setRawCache(value: unknown): void {
  mockStorage.set(PR_CACHE_STORAGE_KEY, JSON.stringify(value))
}

function setMultiOrgCache(entries: Record<string, { timestamp: number; org: string; data: typeof sampleData }>): void {
  setRawCache({ version: CACHE_SCHEMA_VERSION, entries })
}

describe('pr-cache (multi-org)', () => {
  beforeEach(() => {
    mockStorage.clear()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('readCachedPRData', () => {
    it('should return null when localStorage is empty', () => {
      const result = readCachedPRData(orgId)
      expect(result).toBeNull()
    })

    it('should return identical data after write and read round-trip', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)

      writeCachedPRData(orgId, org, sampleData)
      const result = readCachedPRData(orgId)

      expect(result).toEqual(sampleData)
    })

    it('should return null for corrupt JSON without throwing', () => {
      mockStorage.set(PR_CACHE_STORAGE_KEY, '{broken')

      expect(() => readCachedPRData(orgId)).not.toThrow()
      expect(readCachedPRData(orgId)).toBeNull()
    })

    it('should return null when getItem throws SecurityError', () => {
      localStorageMock.getItem.mockImplementationOnce(() => {
        throw new Error('SecurityError')
      })

      expect(() => readCachedPRData(orgId)).not.toThrow()
      expect(readCachedPRData(orgId)).toBeNull()
    })

    it('should return null when cache is older than max age', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      setMultiOrgCache({
        [orgId]: {
          timestamp: fixedNow - CACHE_MAX_AGE_MS - 1,
          org,
          data: sampleData,
        },
      })

      const result = readCachedPRData(orgId)

      expect(result).toBeNull()
    })

    it('should return null when schema version mismatches', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      setRawCache({
        version: CACHE_SCHEMA_VERSION + 1,
        entries: {
          [orgId]: { timestamp: fixedNow, org, data: sampleData },
        },
      })

      const result = readCachedPRData(orgId)

      expect(result).toBeNull()
    })

    it('should round-trip recentlyMerged data', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)

      writeCachedPRData(orgId, org, sampleData)
      const result = readCachedPRData(orgId)

      expect(result?.recentlyMerged).toEqual([sampleMergedPR])
      expect(result?.recentlyMerged[0].role).toBe('author')
      expect(result?.recentlyMerged[0].mergedAtIso).toBe('2026-03-25T08:00:00.000Z')
    })

    it('should return null when orgId is not in cache', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      setMultiOrgCache({
        'other-org-id': { timestamp: fixedNow, org: 'other-org', data: sampleData },
      })

      const result = readCachedPRData(orgId)

      expect(result).toBeNull()
    })

    it('should store and retrieve multiple orgs independently', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      const orgId2 = 'org-2'
      const org2 = 'acme-corp'

      writeCachedPRData(orgId, org, sampleData)
      writeCachedPRData(orgId2, org2, { ...sampleData, teamSignalsUnavailable: 'no teams' })

      const result1 = readCachedPRData(orgId)
      const result2 = readCachedPRData(orgId2)

      expect(result1?.teamSignalsUnavailable).toBeNull()
      expect(result2?.teamSignalsUnavailable).toBe('no teams')
    })

    it('should migrate legacy single-org format on read', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      // Legacy format (version 5)
      setRawCache({
        version: 5,
        timestamp: fixedNow,
        org,
        data: sampleData,
      })

      const legacyKey = `legacy-${org}`
      const result = readCachedPRData(legacyKey)

      expect(result).toEqual(sampleData)
    })
  })

  describe('isCacheStale', () => {
    it('should return true when cache is older than revalidation ttl and still readable', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      setMultiOrgCache({
        [orgId]: {
          timestamp: fixedNow - CACHE_REVALIDATION_TTL_MS - 60_000,
          org,
          data: sampleData,
        },
      })

      const stale = isCacheStale(orgId)
      const cachedData = readCachedPRData(orgId)

      expect(stale).toBe(true)
      expect(cachedData).toEqual(sampleData)
    })

    it('should return true when orgId is not cached', () => {
      expect(isCacheStale('nonexistent')).toBe(true)
    })
  })

  describe('isAnyCacheStale', () => {
    it('should return true when any org is stale', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      setMultiOrgCache({
        [orgId]: { timestamp: fixedNow, org, data: sampleData },
        'org-2': { timestamp: fixedNow - CACHE_REVALIDATION_TTL_MS - 1, org: 'acme', data: sampleData },
      })

      expect(isAnyCacheStale([orgId, 'org-2'])).toBe(true)
    })

    it('should return false when all orgs are fresh', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      setMultiOrgCache({
        [orgId]: { timestamp: fixedNow, org, data: sampleData },
        'org-2': { timestamp: fixedNow, org: 'acme', data: sampleData },
      })

      expect(isAnyCacheStale([orgId, 'org-2'])).toBe(false)
    })

    it('should return true for empty orgIds array', () => {
      expect(isAnyCacheStale([])).toBe(true)
    })
  })

  describe('writeCachedPRData', () => {
    it('should not throw when setItem throws QuotaExceededError', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('QuotaExceededError')
      })

      expect(() => writeCachedPRData(orgId, org, sampleData)).not.toThrow()
    })

    it('should not throw when setItem throws SecurityError', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('SecurityError')
      })

      expect(() => writeCachedPRData(orgId, org, sampleData)).not.toThrow()
    })
  })

  describe('invalidatePRCache', () => {
    it('should remove entire cache when called without orgId', () => {
      setMultiOrgCache({
        [orgId]: { timestamp: fixedNow, org, data: sampleData },
      })

      invalidatePRCache()

      expect(mockStorage.has(PR_CACHE_STORAGE_KEY)).toBe(false)
    })

    it('should remove only the specified orgId entry', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      const orgId2 = 'org-2'

      writeCachedPRData(orgId, org, sampleData)
      writeCachedPRData(orgId2, 'acme', sampleData)

      invalidatePRCache(orgId)

      expect(readCachedPRData(orgId)).toBeNull()
      expect(readCachedPRData(orgId2)).toEqual(sampleData)
    })
  })

  describe('getCacheTimestamp', () => {
    it('should return timestamp for valid cache', () => {
      setMultiOrgCache({
        [orgId]: { timestamp: fixedNow, org, data: sampleData },
      })

      const result = getCacheTimestamp(orgId)

      expect(result).toBe(fixedNow)
    })

    it('should return null for missing orgId', () => {
      const result = getCacheTimestamp(orgId)

      expect(result).toBeNull()
    })
  })

  describe('getOldestCacheTimestamp', () => {
    it('should return oldest timestamp across all entries', () => {
      setMultiOrgCache({
        [orgId]: { timestamp: fixedNow, org, data: sampleData },
        'org-2': { timestamp: fixedNow - 5000, org: 'acme', data: sampleData },
      })

      expect(getOldestCacheTimestamp()).toBe(fixedNow - 5000)
    })

    it('should return null when no entries', () => {
      expect(getOldestCacheTimestamp()).toBeNull()
    })
  })
})
