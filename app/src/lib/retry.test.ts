import { describe, expect, it, vi } from 'vitest'

import { RateLimitError } from './github'
import { withRetry } from './retry'

class CustomRetryableError extends Error {
  constructor(message = 'retryable') {
    super(message)
    this.name = 'CustomRetryableError'
  }
}

describe('withRetry', () => {
  it('should return immediately when first attempt succeeds', async () => {
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const fn = vi.fn(async () => 'ok')

    const result = await withRetry(fn)

    expect(result).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    expect(timeoutSpy).not.toHaveBeenCalled()
  })

  it('should retry once on RateLimitError and then succeed', async () => {
    vi.useFakeTimers()

    let callCount = 0
    const fn = vi.fn(async () => {
      callCount += 1
      if (callCount === 1) {
        throw new RateLimitError()
      }

      return 'success'
    })

    const promise = withRetry(fn, { maxRetries: 2, initialDelayMs: 1000, jitter: false })

    await vi.runAllTimersAsync()

    const result = await promise
    expect(result).toBe('success')
    expect(fn).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('should throw the original RateLimitError after retries are exhausted', async () => {
    vi.useFakeTimers()

    const originalError = new RateLimitError('still limited')
    const fn = vi.fn(async () => {
      throw originalError
    })

    const promise = withRetry(fn, { maxRetries: 2, jitter: false })
    const rejection = expect(promise).rejects.toBe(originalError)

    await vi.runAllTimersAsync()

    await rejection
    expect(fn).toHaveBeenCalledTimes(3)

    vi.useRealTimers()
  })

  it('should throw non-retryable errors immediately', async () => {
    const originalError = new Error('boom')
    const fn = vi.fn(async () => {
      throw originalError
    })

    await expect(withRetry(fn)).rejects.toBe(originalError)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('should respect a custom shouldRetry predicate', async () => {
    vi.useFakeTimers()

    let callCount = 0
    const fn = vi.fn(async () => {
      callCount += 1
      if (callCount === 1) {
        throw new CustomRetryableError()
      }

      return 'custom-success'
    })

    const promise = withRetry(fn, {
      maxRetries: 2,
      initialDelayMs: 100,
      jitter: false,
      shouldRetry: (error: unknown) => error instanceof CustomRetryableError,
    })

    await vi.runAllTimersAsync()

    await expect(promise).resolves.toBe('custom-success')
    expect(fn).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('should use exponential delay growth when jitter is disabled', async () => {
    vi.useFakeTimers()
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const fn = vi.fn(async () => {
      throw new RateLimitError()
    })

    const promise = withRetry(fn, { maxRetries: 3, initialDelayMs: 1000, backoffMultiplier: 2, jitter: false })
    const settled = promise.catch(() => undefined)

    await vi.runAllTimersAsync()
    await settled

    const delays = timeoutSpy.mock.calls.map(([, ms]) => ms)
    expect(delays).toEqual([1000, 2000, 4000])

    vi.useRealTimers()
  })

  it('should cap delays at maxDelayMs', async () => {
    vi.useFakeTimers()
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')

    const fn = vi.fn(async () => {
      throw new RateLimitError()
    })

    const promise = withRetry(fn, {
      maxRetries: 4,
      initialDelayMs: 1000,
      backoffMultiplier: 3,
      maxDelayMs: 2500,
      jitter: false,
    })
    const settled = promise.catch(() => undefined)

    await vi.runAllTimersAsync()
    await settled

    const delays = timeoutSpy.mock.calls.map(([, ms]) => ms)
    expect(delays).toEqual([1000, 2500, 2500, 2500])

    vi.useRealTimers()
  })

  it('should apply jitter between 50% and 150% of the base delay', async () => {
    vi.useFakeTimers()
    const timeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValueOnce(0).mockReturnValueOnce(1)

    const fn = vi.fn(async () => {
      throw new RateLimitError()
    })

    const promise = withRetry(fn, {
      maxRetries: 2,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
      jitter: true,
    })
    const settled = promise.catch(() => undefined)

    await vi.runAllTimersAsync()
    await settled

    const delays = timeoutSpy.mock.calls.map(([, ms]) => ms as number)
    expect(delays[0]).toBeGreaterThanOrEqual(500)
    expect(delays[0]).toBeLessThanOrEqual(1500)
    expect(delays[1]).toBeGreaterThanOrEqual(1000)
    expect(delays[1]).toBeLessThanOrEqual(3000)
    expect(delays).toEqual([500, 3000])
    expect(randomSpy).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })
})
