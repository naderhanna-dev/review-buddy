import { checkForNotificationChanges, type NotificationCheckResult } from './notifications'

export type SmartRefreshConfig = {
  token: string
  org: string
  onRefresh: () => void
  fallbackIntervalMs?: number
  degradedIntervalMs?: number
  debounceMs?: number
}

export class SmartRefreshController {
  private notificationTimerId: ReturnType<typeof setTimeout> | null = null
  private fallbackTimerId: ReturnType<typeof setTimeout> | null = null
  private debounceTimerId: ReturnType<typeof setTimeout> | null = null
  private lastModified: string | undefined = undefined
  private readonly config: Required<SmartRefreshConfig>

  constructor(config: SmartRefreshConfig) {
    this.config = {
      fallbackIntervalMs: 10 * 60 * 1000,
      degradedIntervalMs: 2 * 60 * 1000,
      debounceMs: 5 * 1000,
      ...config,
    }
  }

  start(): void {
    this.scheduleNotificationPoll(60)
    this.scheduleFallbackRefresh()
  }

  stop(): void {
    if (this.notificationTimerId) {
      clearTimeout(this.notificationTimerId)
    }
    if (this.fallbackTimerId) {
      clearTimeout(this.fallbackTimerId)
    }
    if (this.debounceTimerId) {
      clearTimeout(this.debounceTimerId)
    }

    this.notificationTimerId = null
    this.fallbackTimerId = null
    this.debounceTimerId = null
  }

  private scheduleNotificationPoll(intervalSeconds: number): void {
    if (this.notificationTimerId) {
      clearTimeout(this.notificationTimerId)
    }

    this.notificationTimerId = setTimeout(() => {
      void this.pollNotifications()
    }, intervalSeconds * 1000)
  }

  private scheduleFallbackRefresh(): void {
    if (this.fallbackTimerId) {
      clearTimeout(this.fallbackTimerId)
    }

    this.fallbackTimerId = setTimeout(() => {
      this.triggerRefresh()
      this.scheduleFallbackRefresh()
    }, this.config.fallbackIntervalMs)
  }

  private async pollNotifications(): Promise<void> {
    let result: NotificationCheckResult

    try {
      result = await checkForNotificationChanges(this.config.token, this.config.org, this.lastModified)
    } catch {
      this.scheduleNotificationPoll(this.config.degradedIntervalMs / 1000)
      return
    }

    if (result.lastModified) {
      this.lastModified = result.lastModified
    }

    if (result.notificationsUnavailable) {
      this.triggerRefresh()
      this.scheduleNotificationPoll(this.config.degradedIntervalMs / 1000)
      return
    }

    if (result.hasChanges) {
      this.triggerRefresh()
    }

    this.scheduleNotificationPoll(result.pollIntervalSeconds)
  }

  private triggerRefresh(): void {
    if (this.debounceTimerId) {
      return
    }

    this.debounceTimerId = setTimeout(() => {
      this.debounceTimerId = null
      this.config.onRefresh()
    }, this.config.debounceMs)
  }
}
