const GITHUB_API_ORIGIN = 'https://api.github.com'

let base = GITHUB_API_ORIGIN

/**
 * Override the GitHub API base URL.  Set to a relative path like
 * `/api/github` to proxy requests through the local server (avoids
 * browser CORS restrictions when the dashboard is not on localhost).
 */
export function setGitHubApiBase(url: string) {
  base = url.replace(/\/$/, '')
}

export function getGitHubApiBase() {
  return base
}

/**
 * Rewrite a full `https://api.github.com/...` URL to use the
 * configured base.  Returns the URL unchanged when the base has not
 * been overridden.
 */
export function resolveGitHubUrl(url: string): string {
  if (base === GITHUB_API_ORIGIN) return url
  if (url.startsWith(GITHUB_API_ORIGIN)) {
    return base + url.slice(GITHUB_API_ORIGIN.length)
  }
  return url
}
