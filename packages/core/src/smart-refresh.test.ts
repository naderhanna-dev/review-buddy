import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkForNotificationChanges } from './notifications'
import { rateLimitTracker } from './rate-limit-tracker'
import { SmartRefreshController } from './smart-refresh'

vi.mock('./notifications', () => ({
  checkForNotificationChanges: vi.fn(),
}))

describe('SmartRefreshController', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(checkForNotificationChanges).mockResolvedValue({
      hasChanges: false,
      pollIntervalSeconds: 60,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    rateLimitTracker.clear()
  })

  it('should schedule a notification poll on start', () => {
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
    const controller = new SmartRefreshController({
      token: 'token',
      org: 'acme',
      onRefresh: vi.fn(),
    })

    controller.start()

    expect(setTimeoutSpy).toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(2)
  })

  it('should call onRefresh after debounce when hasChanges is true', async () => {
    const onRefresh = vi.fn()
    vi.mocked(checkForNotificationChanges).mockResolvedValue({
      hasChanges: true,
      pollIntervalSeconds: 60,
    })

    const controller = new SmartRefreshController({
      token: 'token',
      org: 'acme',
      onRefresh,
      debounceMs: 1_000,
    })

    controller.start()
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('should not call onRefresh when hasChanges is false', async () => {
    const onRefresh = vi.fn()
    const controller = new SmartRefreshController({
      token: 'token',
      org: 'acme',
      onRefresh,
      debounceMs: 1_000,
    })

    controller.start()
    await vi.advanceTimersByTimeAsync(65_000)

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('should switch to degraded interval when notifications are unavailable and trigger refresh', async () => {
    const onRefresh = vi.fn()
    vi.mocked(checkForNotificationChanges).mockResolvedValue({
      hasChanges: false,
      pollIntervalSeconds: 60,
      notificationsUnavailable: true,
    })

    const controller = new SmartRefreshController({
      token: 'token',
      org: 'acme',
      onRefresh,
      degradedIntervalMs: 5_000,
      debounceMs: 1_000,
    })

    controller.start()
    // First poll at 60s
    await vi.advanceTimersByTimeAsync(60_000)
    // Debounce fires after 1s
    await vi.advanceTimersByTimeAsync(1_000)

    expect(onRefresh).toHaveBeenCalledOnce()
    expect(checkForNotificationChanges).toHaveBeenCalledTimes(1)

    // Degraded poll at 5s
    await vi.advanceTimersByTimeAsync(5_000)
    // Debounce fires after 1s
    await vi.advanceTimersByTimeAsync(1_000)

    expect(onRefresh).toHaveBeenCalledTimes(2)
    expect(checkForNotificationChanges).toHaveBeenCalledTimes(2)
  })

  it('should debounce multiple rapid change signals into one refresh', async () => {
    const onRefresh = vi.fn()
    const controller = new SmartRefreshController({
      token: 'token',
      org: 'acme',
      onRefresh,
      fallbackIntervalMs: 1_000,
      debounceMs: 5_000,
    })

    controller.start()

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(onRefresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(3_000)

    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('should clear all timers on stop', () => {
    const controller = new SmartRefreshController({
      token: 'token',
      org: 'acme',
      onRefresh: vi.fn(),
    })

    controller.start()
    expect(vi.getTimerCount()).toBe(2)

    controller.stop()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('should trigger fallback refresh after fallback interval', async () => {
    const onRefresh = vi.fn()
    const controller = new SmartRefreshController({
      token: 'token',
      org: 'acme',
      onRefresh,
      fallbackIntervalMs: 2_000,
      debounceMs: 500,
    })

    controller.start()
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(500)

    expect(onRefresh).toHaveBeenCalledOnce()
  })

  it('should not call onRefresh when notification poll returns rateLimited', async () => {
    const onRefresh = vi.fn()
    vi.mocked(checkForNotificationChanges).mockResolvedValue({
      hasChanges: true,
      pollIntervalSeconds: 300,
      rateLimited: true,
    })

    const controller = new SmartRefreshController({
      token: 'token',
      org: 'acme',
      onRefresh,
      debounceMs: 1_000,
    })

    controller.start()
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.advanceTimersByTimeAsync(1_000)

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('should suppress triggerRefresh when token is rate limited', async () => {
    const onRefresh = vi.fn()
    const futureReset = Math.floor(Date.now() / 1000) + 600

    rateLimitTracker.update('token', new Headers({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(futureReset),
    }))

    vi.mocked(checkForNotificationChanges).mockResolvedValue({
      hasChanges: true,
      pollIntervalSeconds: 60,
    })

    const controller = new SmartRefreshController({
      token: 'token',
      org: 'acme',
      onRefresh,
      fallbackIntervalMs: 2_000,
      debounceMs: 500,
    })

    controller.start()
    await vi.advanceTimersByTimeAsync(2_000)
    await vi.advanceTimersByTimeAsync(500)

    expect(onRefresh).not.toHaveBeenCalled()
  })

  it('should defer fallback refresh to reset time when rate limited', async () => {
    const onRefresh = vi.fn()
    const futureReset = Math.floor(Date.now() / 1000) + 30

    rateLimitTracker.update('token', new Headers({
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(futureReset),
    }))

    const controller = new SmartRefreshController({
      token: 'token',
      org: 'acme',
      onRefresh,
      fallbackIntervalMs: 5_000,
      debounceMs: 500,
    })

    controller.start()

    await vi.advanceTimersByTimeAsync(5_000)
    expect(onRefresh).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(26_000)
    await vi.advanceTimersByTimeAsync(500)

    expect(onRefresh).toHaveBeenCalledOnce()
    controller.stop()
  })
})
