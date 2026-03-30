import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CACHE_MAX_AGE_MS,
  CACHE_REVALIDATION_TTL_MS,
  CACHE_SCHEMA_VERSION,
  PR_CACHE_STORAGE_KEY,
  getCacheTimestamp,
  invalidatePRCache,
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

describe('pr-cache', () => {
  beforeEach(() => {
    mockStorage.clear()
    vi.clearAllMocks()
    vi.restoreAllMocks()
  })

  describe('readCachedPRData', () => {
    it('should return null when localStorage is empty', () => {
      const result = readCachedPRData(org)
      expect(result).toBeNull()
    })

    it('should return identical data after write and read round-trip', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)

      writeCachedPRData(org, sampleData)
      const result = readCachedPRData(org)

      expect(result).toEqual(sampleData)
    })

    it('should return null for corrupt JSON without throwing', () => {
      mockStorage.set(PR_CACHE_STORAGE_KEY, '{broken')

      expect(() => readCachedPRData(org)).not.toThrow()
      expect(readCachedPRData(org)).toBeNull()
    })

    it('should return null when getItem throws SecurityError', () => {
      localStorageMock.getItem.mockImplementationOnce(() => {
        throw new Error('SecurityError')
      })

      expect(() => readCachedPRData(org)).not.toThrow()
      expect(readCachedPRData(org)).toBeNull()
    })

    it('should return null when cache is older than max age', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      setRawCache({
        version: CACHE_SCHEMA_VERSION,
        timestamp: fixedNow - CACHE_MAX_AGE_MS - 1,
        org,
        data: sampleData,
      })

      const result = readCachedPRData(org)

      expect(result).toBeNull()
    })

    it('should return null when schema version mismatches', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      setRawCache({
        version: CACHE_SCHEMA_VERSION + 1,
        timestamp: fixedNow,
        org,
        data: sampleData,
      })

      const result = readCachedPRData(org)

      expect(result).toBeNull()
    })

    it('should round-trip recentlyMerged data', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)

      writeCachedPRData(org, sampleData)
      const result = readCachedPRData(org)

      expect(result?.recentlyMerged).toEqual([sampleMergedPR])
      expect(result?.recentlyMerged[0].role).toBe('author')
      expect(result?.recentlyMerged[0].mergedAtIso).toBe('2026-03-25T08:00:00.000Z')
    })

    it('should reject old schema version 1 caches missing recentlyMerged', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      setRawCache({
        version: 1,
        timestamp: fixedNow,
        org,
        data: {
          yourPrs: [samplePullRequest],
          needsAttention: [],
          relatedToYou: [],
          stalePrs: [],
          teamSignalsUnavailable: null,
        },
      })

      const result = readCachedPRData(org)

      expect(result).toBeNull()
    })

    it('should return null when org mismatches', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      setRawCache({
        version: CACHE_SCHEMA_VERSION,
        timestamp: fixedNow,
        org: 'other-org',
        data: sampleData,
      })

      const result = readCachedPRData(org)

      expect(result).toBeNull()
    })
  })

  describe('isCacheStale', () => {
    it('should return true when cache is older than revalidation ttl and still readable', () => {
      vi.spyOn(Date, 'now').mockReturnValue(fixedNow)
      setRawCache({
        version: CACHE_SCHEMA_VERSION,
        timestamp: fixedNow - CACHE_REVALIDATION_TTL_MS - 60_000,
        org,
        data: sampleData,
      })

      const stale = isCacheStale(org)
      const cachedData = readCachedPRData(org)

      expect(stale).toBe(true)
      expect(cachedData).toEqual(sampleData)
    })
  })

  describe('writeCachedPRData', () => {
    it('should not throw when setItem throws QuotaExceededError', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('QuotaExceededError')
      })

      expect(() => writeCachedPRData(org, sampleData)).not.toThrow()
    })

    it('should not throw when setItem throws SecurityError', () => {
      localStorageMock.setItem.mockImplementationOnce(() => {
        throw new Error('SecurityError')
      })

      expect(() => writeCachedPRData(org, sampleData)).not.toThrow()
    })
  })

  describe('invalidatePRCache', () => {
    it('should remove key from localStorage', () => {
      setRawCache({
        version: CACHE_SCHEMA_VERSION,
        timestamp: fixedNow,
        org,
        data: sampleData,
      })

      invalidatePRCache()

      expect(mockStorage.has(PR_CACHE_STORAGE_KEY)).toBe(false)
    })
  })

  describe('getCacheTimestamp', () => {
    it('should return timestamp for valid cache', () => {
      setRawCache({
        version: CACHE_SCHEMA_VERSION,
        timestamp: fixedNow,
        org,
        data: sampleData,
      })

      const result = getCacheTimestamp(org)

      expect(result).toBe(fixedNow)
    })

    it('should return null for missing cache', () => {
      const result = getCacheTimestamp(org)

      expect(result).toBeNull()
    })

    it('should return null for invalid cache', () => {
      setRawCache({
        version: CACHE_SCHEMA_VERSION + 1,
        timestamp: fixedNow,
        org,
        data: sampleData,
      })

      const result = getCacheTimestamp(org)

      expect(result).toBeNull()
    })
  })
})
