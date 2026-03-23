import { beforeEach, describe, expect, it, vi } from 'vitest'

import { EtagCache } from './etag-cache'
import { apiFetch } from './github'

vi.stubGlobal('fetch', vi.fn())

describe('apiFetch', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
  })

  it('should send correct GitHub API headers', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ login: 'testuser' }), { status: 200 })
    )

    await apiFetch('https://api.github.com/user', 'test-token')

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/user',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer test-token',
          'X-GitHub-Api-Version': '2022-11-28',
        }),
      })
    )
  })

  it('should return parsed JSON on 200 response', async () => {
    const mockData = { login: 'testuser', id: 123 }
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify(mockData), { status: 200 })
    )

    const result = await apiFetch('https://api.github.com/user', 'test-token')

    expect(result).toEqual(mockData)
  })

  it('should throw "Invalid token..." on 401 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 401 }))

    await expect(
      apiFetch('https://api.github.com/user', 'bad-token')
    ).rejects.toThrow('Invalid token. Check PAT scope and retry.')
  })

  it('should throw "Access forbidden or rate limit..." on 403 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 403 }))

    await expect(
      apiFetch('https://api.github.com/user', 'test-token')
    ).rejects.toThrow('Access forbidden or rate limit hit. Retry in a few minutes.')
  })

  it('should throw "GitHub request failed..." on other non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }))

    await expect(
      apiFetch('https://api.github.com/user', 'test-token')
    ).rejects.toThrow('GitHub request failed (404).')
  })

  describe('with ETag cache', () => {
    const url = 'https://api.github.com/user'
    const token = 'test-token'
    let cache: EtagCache

    beforeEach(() => {
      cache = new EtagCache()
    })

    it('should send If-None-Match header when cache has entry for URL', async () => {
      cache.set(url, '"abc123"', { login: 'me' })
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ login: 'me' }), { status: 200, headers: { etag: '"abc123"' } })
      )

      await apiFetch(url, token, cache)

      expect(fetch).toHaveBeenCalledWith(
        url,
        expect.objectContaining({
          headers: expect.objectContaining({
            'If-None-Match': '"abc123"',
          }),
        })
      )
    })

    it('should return cached data on 304 response', async () => {
      cache.set(url, '"abc123"', { login: 'me' })
      vi.mocked(fetch).mockResolvedValueOnce({
        ok: false,
        status: 304,
        headers: new Headers(),
      } as Response)

      const result = await apiFetch<{ login: string }>(url, token, cache)

      expect(result).toEqual({ login: 'me' })
    })

    it('should store ETag in cache on 200 response with ETag header', async () => {
      const data = { login: 'fresh' }
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(data), { status: 200, headers: { etag: '"new-etag"' } })
      )

      await apiFetch(url, token, cache)

      expect(cache.has(url)).toBe(true)
      expect(cache.getEtag(url)).toBe('"new-etag"')
      expect(cache.get(url)?.data).toEqual(data)
    })

    it('should not send If-None-Match header when URL is not cached', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ login: 'me' }), { status: 200 })
      )

      await apiFetch(url, token, cache)

      const calledHeaders = vi.mocked(fetch).mock.calls[0]?.[1] as RequestInit | undefined
      const headers = calledHeaders?.headers as Record<string, string> | undefined
      expect(headers).not.toHaveProperty('If-None-Match')
    })

    it('should return data on 200 without ETag header and not cache', async () => {
      const data = { login: 'no-etag' }
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(data), { status: 200 })
      )

      const result = await apiFetch(url, token, cache)

      expect(result).toEqual(data)
      expect(cache.size).toBe(0)
    })

    it('should work without cache argument (backwards compatible)', async () => {
      const data = { login: 'compat' }
      vi.mocked(fetch).mockResolvedValueOnce(
        new Response(JSON.stringify(data), { status: 200 })
      )

      const result = await apiFetch(url, token)

      expect(result).toEqual(data)
    })
  })
})
