export type RateLimitState = {
  limit: number
  remaining: number
  /** epoch seconds — not milliseconds */
  resetEpochSeconds: number
}

export class RateLimitTracker {
  private state = new Map<string, RateLimitState>()

  update(token: string, headers: Headers): void {
    const limit = headers.get('x-ratelimit-limit')
    const remaining = headers.get('x-ratelimit-remaining')
    const reset = headers.get('x-ratelimit-reset')

    if (limit === null || remaining === null || reset === null) {
      return
    }

    const parsedLimit = parseInt(limit, 10)
    const parsedRemaining = parseInt(remaining, 10)
    const parsedReset = parseInt(reset, 10)

    if (isNaN(parsedLimit) || isNaN(parsedRemaining) || isNaN(parsedReset)) {
      return
    }

    this.state.set(token, {
      limit: parsedLimit,
      remaining: parsedRemaining,
      resetEpochSeconds: parsedReset,
    })
  }

  isRateLimited(token: string): boolean {
    const s = this.state.get(token)
    if (!s) return false
    return s.remaining === 0 && s.resetEpochSeconds > Date.now() / 1000
  }

  getMsUntilReset(token: string): number {
    const s = this.state.get(token)
    if (!s) return 0
    return Math.max(0, s.resetEpochSeconds * 1000 - Date.now())
  }

  getState(token: string): RateLimitState | undefined {
    return this.state.get(token)
  }

  clear(): void {
    this.state.clear()
  }
}

export const rateLimitTracker = new RateLimitTracker()
