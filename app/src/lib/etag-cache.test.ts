import { describe, expect, it, beforeEach } from 'vitest'

import { EtagCache, etagCache } from './etag-cache'

describe('EtagCache', () => {
  let cache: EtagCache

  beforeEach(() => {
    cache = new EtagCache()
  })

  describe('set and get', () => {
    it('should store entry and return it via get', () => {
      const url = 'https://api.github.com/repos/owner/repo/pulls/1'
      const etag = '"abc123"'
      const data = { id: 1, title: 'Test PR' }

      cache.set(url, etag, data)
      const entry = cache.get(url)

      expect(entry).toBeDefined()
      expect(entry?.etag).toBe(etag)
      expect(entry?.data).toEqual(data)
    })
  })

  describe('getEtag', () => {
    it('should return just the ETag string for a cached URL', () => {
      const url = 'https://api.github.com/repos/owner/repo/pulls/1'
      const etag = '"abc123"'
      const data = { id: 1 }

      cache.set(url, etag, data)
      const result = cache.getEtag(url)

      expect(result).toBe(etag)
    })

    it('should return undefined for uncached URL', () => {
      const result = cache.getEtag('https://uncached.url')
      expect(result).toBeUndefined()
    })
  })

  describe('has', () => {
    it('should return true for cached URL', () => {
      const url = 'https://api.github.com/repos/owner/repo/pulls/1'
      cache.set(url, '"etag"', { id: 1 })

      expect(cache.has(url)).toBe(true)
    })

    it('should return false for uncached URL', () => {
      expect(cache.has('https://uncached.url')).toBe(false)
    })
  })

  describe('clear', () => {
    it('should empty the cache and set size to 0', () => {
      cache.set('https://url1', '"etag1"', { id: 1 })
      cache.set('https://url2', '"etag2"', { id: 2 })

      expect(cache.size).toBe(2)

      cache.clear()

      expect(cache.size).toBe(0)
      expect(cache.get('https://url1')).toBeUndefined()
      expect(cache.get('https://url2')).toBeUndefined()
    })
  })

  describe('get on uncached URL', () => {
    it('should return undefined', () => {
      const result = cache.get('https://never-cached.url')
      expect(result).toBeUndefined()
    })
  })

  describe('LRU eviction', () => {
    it('should evict oldest entry when cache reaches MAX_ENTRIES', () => {
      // Fill cache to MAX_ENTRIES (200)
      for (let i = 0; i < 200; i++) {
        cache.set(`https://url${i}`, `"etag${i}"`, { id: i })
      }

      expect(cache.size).toBe(200)

      // Add one more — should evict the oldest (url0)
      cache.set('https://url200', '"etag200"', { id: 200 })

      expect(cache.size).toBe(200)
      expect(cache.has('https://url0')).toBe(false)
      expect(cache.has('https://url200')).toBe(true)
    })
  })

  describe('LRU touch on get', () => {
    it('should update accessedAt when get is called, protecting from eviction', async () => {
      // Fill cache to MAX_ENTRIES
      for (let i = 0; i < 200; i++) {
        cache.set(`https://url${i}`, `"etag${i}"`, { id: i })
      }

      // Small delay to ensure time difference
      await new Promise(resolve => setTimeout(resolve, 1))

      // Touch url0 (access it) — this updates its accessedAt
      cache.get('https://url0')

      // Add new entry — should evict url1 (oldest), not url0
      cache.set('https://url200', '"etag200"', { id: 200 })

      expect(cache.has('https://url0')).toBe(true)
      expect(cache.has('https://url1')).toBe(false)
      expect(cache.has('https://url200')).toBe(true)
    })
  })
})

describe('etagCache singleton', () => {
  it('should export a singleton instance', () => {
    expect(etagCache).toBeInstanceOf(EtagCache)
  })
})
