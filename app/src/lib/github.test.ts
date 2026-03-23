import { beforeEach, describe, expect, it, vi } from 'vitest'

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
})
