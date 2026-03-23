import { type EtagCache } from './etag-cache'

export type SearchIssueItem = {
  pull_request?: {
    url: string
  }
}

export type SearchIssuesResponse = {
  items: SearchIssueItem[]
}

export type GitHubUser = {
  login: string
}

export type Team = {
  slug: string
  organization: {
    login: string
  }
}

export type CombinedStatusResponse = {
  state: string
}

export async function apiFetch<T>(url: string, token: string, cache?: EtagCache): Promise<T> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  }

  if (cache?.has(url)) {
    const etag = cache.getEtag(url)
    if (etag) {
      headers['If-None-Match'] = etag
    }
  }

  const response = await fetch(url, { headers })

  // 304 must be checked before !response.ok — fetch treats 304 as not-ok
  if (response.status === 304) {
    const cached = cache?.get(url)
    if (cached) {
      return cached.data as T
    }
  }

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Invalid token. Check PAT scope and retry.')
    }

    if (response.status === 403) {
      throw new Error('Access forbidden or rate limit hit. Retry in a few minutes.')
    }

    if (response.status === 422) {
      throw new Error(
        'Token not authorized for this org. ' +
          'The Resource owner cannot be changed on an existing token — ' +
          'regenerate it at github.com/settings/personal-access-tokens/new ' +
          'and set Resource owner to the org you configured in ReviewRadar.',
      )
    }

    throw new Error(`GitHub request failed (${response.status}).`)
  }

  const data = (await response.json()) as T

  const etag = response.headers.get('etag')
  if (etag && cache) {
    cache.set(url, etag, data)
  }

  return data
}
