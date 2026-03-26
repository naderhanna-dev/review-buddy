import { beforeEach, describe, expect, it, vi } from 'vitest'

import { graphqlFetch, RateLimitError } from './graphql'

vi.stubGlobal('fetch', vi.fn())

describe('graphqlFetch', () => {
  beforeEach(() => {
    vi.mocked(fetch).mockReset()
  })

  it('should send correct headers with POST method', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { viewer: { login: 'me' } } }), { status: 200 })
    )

    await graphqlFetch(
      'query { viewer { login } }',
      {},
      'test-token'
    )

    expect(fetch).toHaveBeenCalledWith(
      'https://api.github.com/graphql',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-token',
          'X-GitHub-Api-Version': '2022-11-28',
        }),
      })
    )
  })

  it('should send correct body with query and variables', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: { viewer: { login: 'me' } } }), { status: 200 })
    )

    const query = 'query GetViewer { viewer { login } }'
    const variables = { org: 'test-org' }

    await graphqlFetch(query, variables, 'test-token')

    const callArgs = vi.mocked(fetch).mock.calls[0]
    const body = callArgs?.[1]?.body as string | undefined
    expect(body).toBe(JSON.stringify({ query, variables }))
  })

  it('should return data on successful 200 response', async () => {
    const mockData = { viewer: { login: 'me' } }
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ data: mockData }), { status: 200 })
    )

    const result = await graphqlFetch(
      'query { viewer { login } }',
      {},
      'test-token'
    )

    expect(result).toEqual(mockData)
  })

  it('should throw RateLimitError on 403 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 403 }))

    await expect(
      graphqlFetch('query { viewer { login } }', {}, 'test-token')
    ).rejects.toThrow(RateLimitError)
  })

  it('should throw RateLimitError on 429 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 429 }))

    await expect(
      graphqlFetch('query { viewer { login } }', {}, 'test-token')
    ).rejects.toThrow(RateLimitError)
  })

  it('should throw "Invalid token..." on 401 response', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 401 }))

    await expect(
      graphqlFetch('query { viewer { login } }', {}, 'bad-token')
    ).rejects.toThrow('Invalid token. Check PAT scope and retry.')
  })

  it('should throw "GitHub request failed..." on other non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 500 }))

    await expect(
      graphqlFetch('query { viewer { login } }', {}, 'test-token')
    ).rejects.toThrow('GitHub request failed (500).')
  })

  it('should throw RateLimitError when response contains rate limit error message', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [{ message: 'API rate limit exceeded' }],
        }),
        { status: 200 }
      )
    )

    await expect(
      graphqlFetch('query { viewer { login } }', {}, 'test-token')
    ).rejects.toThrow(RateLimitError)
  })

  it('should throw error with first GraphQL error message for non-rate-limit errors', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [{ message: 'Some GraphQL error' }],
        }),
        { status: 200 }
      )
    )

    await expect(
      graphqlFetch('query { viewer { login } }', {}, 'test-token')
    ).rejects.toThrow('Some GraphQL error')
  })

  it('should detect rate limit error case-insensitively', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: [{ message: 'You have exceeded a secondary rate limit' }],
        }),
        { status: 200 }
      )
    )

    await expect(
      graphqlFetch('query { viewer { login } }', {}, 'test-token')
    ).rejects.toThrow(RateLimitError)
  })
})
