import { RateLimitError } from './github'

export type RetryOptions = {
  maxRetries?: number
  initialDelayMs?: number
  maxDelayMs?: number
  backoffMultiplier?: number
  jitter?: boolean
  shouldRetry?: (error: unknown) => boolean
}

const defaultShouldRetry = (error: unknown): boolean => error instanceof RateLimitError

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxRetries = 2,
    initialDelayMs = 1000,
    maxDelayMs = 30000,
    backoffMultiplier = 2,
    jitter = true,
    shouldRetry = defaultShouldRetry,
  } = options

  let attempt = 0

  while (true) {
    try {
      return await fn()
    } catch (error) {
      if (!shouldRetry(error) || attempt >= maxRetries) {
        throw error
      }

      const baseDelay = Math.min(initialDelayMs * backoffMultiplier ** attempt, maxDelayMs)
      const retryDelay = jitter ? baseDelay * (0.5 + Math.random()) : baseDelay

      await delay(retryDelay)
      attempt += 1
    }
  }
}
