import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RateLimitTracker } from './rate-limit-tracker'

function makeHeaders(values: Record<string, string>): Headers {
  return new Headers(values)
}

describe('RateLimitTracker', () => {
  let tracker: RateLimitTracker

  beforeEach(() => {
    vi.useFakeTimers()
    tracker = new RateLimitTracker()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns not rate limited for unknown tokens', () => {
    expect(tracker.isRateLimited('unknown')).toBe(false)
    expect(tracker.getMsUntilReset('unknown')).toBe(0)
    expect(tracker.getState('unknown')).toBeUndefined()
  })

  it('parses rate limit headers on update', () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 3600

    tracker.update('tok', makeHeaders({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4999',
      'x-ratelimit-reset': String(resetEpoch),
    }))

    const state = tracker.getState('tok')
    expect(state).toEqual({
      limit: 5000,
      remaining: 4999,
      resetEpochSeconds: resetEpoch,
    })
    expect(tracker.isRateLimited('tok')).toBe(false)
  })

  it('detects rate limited state when remaining is 0 and reset is in the future', () => {
    const resetEpoch = Math.floor(Date.now() / 1000) + 600

    tracker.update('tok', makeHeaders({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(resetEpoch),
    }))

    expect(tracker.isRateLimited('tok')).toBe(true)
  })

  it('returns not rate limited when reset time has passed', () => {
    const resetEpoch = Math.floor(Date.now() / 1000) - 10

    tracker.update('tok', makeHeaders({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(resetEpoch),
    }))

    expect(tracker.isRateLimited('tok')).toBe(false)
  })

  it('calculates ms until reset correctly', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))

    const resetEpoch = Math.floor(Date.now() / 1000) + 300

    tracker.update('tok', makeHeaders({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(resetEpoch),
    }))

    expect(tracker.getMsUntilReset('tok')).toBe(300_000)
  })

  it('returns 0 ms until reset when reset has passed', () => {
    const resetEpoch = Math.floor(Date.now() / 1000) - 60

    tracker.update('tok', makeHeaders({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(resetEpoch),
    }))

    expect(tracker.getMsUntilReset('tok')).toBe(0)
  })

  it('skips update when headers are missing', () => {
    tracker.update('tok', makeHeaders({}))

    expect(tracker.getState('tok')).toBeUndefined()
  })

  it('skips update when headers contain non-numeric values', () => {
    tracker.update('tok', makeHeaders({
      'x-ratelimit-limit': 'abc',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '123',
    }))

    expect(tracker.getState('tok')).toBeUndefined()
  })

  it('tracks multiple tokens independently', () => {
    const futureReset = Math.floor(Date.now() / 1000) + 600

    tracker.update('tok-a', makeHeaders({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(futureReset),
    }))

    tracker.update('tok-b', makeHeaders({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '4000',
      'x-ratelimit-reset': String(futureReset),
    }))

    expect(tracker.isRateLimited('tok-a')).toBe(true)
    expect(tracker.isRateLimited('tok-b')).toBe(false)
  })

  it('overwrites state on subsequent updates', () => {
    const futureReset = Math.floor(Date.now() / 1000) + 600

    tracker.update('tok', makeHeaders({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(futureReset),
    }))

    expect(tracker.isRateLimited('tok')).toBe(true)

    tracker.update('tok', makeHeaders({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '5000',
      'x-ratelimit-reset': String(futureReset + 3600),
    }))

    expect(tracker.isRateLimited('tok')).toBe(false)
  })

  it('clears all state', () => {
    const futureReset = Math.floor(Date.now() / 1000) + 600

    tracker.update('tok', makeHeaders({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(futureReset),
    }))

    tracker.clear()

    expect(tracker.isRateLimited('tok')).toBe(false)
    expect(tracker.getState('tok')).toBeUndefined()
  })

  it('becomes not rate limited after time passes the reset epoch', () => {
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))

    const resetEpoch = Math.floor(Date.now() / 1000) + 60

    tracker.update('tok', makeHeaders({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(resetEpoch),
    }))

    expect(tracker.isRateLimited('tok')).toBe(true)

    vi.advanceTimersByTime(61_000)

    expect(tracker.isRateLimited('tok')).toBe(false)
    expect(tracker.getMsUntilReset('tok')).toBe(0)
  })
})
