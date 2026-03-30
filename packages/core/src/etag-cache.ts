const MAX_ENTRIES = 200

type CacheEntry = {
  etag: string
  data: unknown
  accessedAt: number
}

export class EtagCache {
  private readonly store = new Map<string, CacheEntry>()

  get size(): number {
    return this.store.size
  }

  set(url: string, etag: string, data: unknown): void {
    if (this.store.size >= MAX_ENTRIES) {
      const oldest = this.findOldestEntry()
      if (oldest) {
        this.store.delete(oldest)
      }
    }
    this.store.set(url, { etag, data, accessedAt: Date.now() })
  }

  get(url: string): CacheEntry | undefined {
    const entry = this.store.get(url)
    if (entry) {
      entry.accessedAt = Date.now()
    }
    return entry
  }

  getEtag(url: string): string | undefined {
    return this.store.get(url)?.etag
  }

  has(url: string): boolean {
    return this.store.has(url)
  }

  clear(): void {
    this.store.clear()
  }

  private findOldestEntry(): string | undefined {
    let oldestUrl: string | undefined
    let oldestTime = Infinity

    for (const [url, entry] of this.store.entries()) {
      if (entry.accessedAt < oldestTime) {
        oldestTime = entry.accessedAt
        oldestUrl = url
      }
    }

    return oldestUrl
  }
}

export const etagCache = new EtagCache()
