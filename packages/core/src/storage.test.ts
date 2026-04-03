import { describe, expect, it, beforeEach, vi } from 'vitest'

import { readSectionSortPreferences, readSectionFilterPreferences, writeSectionFilterPreferences } from './storage'
import { STORAGE_KEYS } from './constants'

const mockStorage = new Map<string, string>()
const localStorageMock = {
  getItem: vi.fn((key: string) => mockStorage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    mockStorage.set(key, value)
  }),
  clear: vi.fn(() => {
    mockStorage.clear()
  }),
}

vi.stubGlobal('localStorage', localStorageMock)
vi.stubGlobal('window', {})

describe('readSectionSortPreferences', () => {
  beforeEach(() => {
    mockStorage.clear()
    vi.clearAllMocks()
  })

  it('should return default for yourPrs when author-az is stored', () => {
    const stored = {
      yourPrs: 'author-az',
    }
    mockStorage.set(STORAGE_KEYS.sectionSort, JSON.stringify(stored))
    const result = readSectionSortPreferences()
    expect(result.yourPrs).toBe('default')
  })

  it('should preserve all valid sort values', () => {
    const stored = {
      needsAttention: 'oldest-first',
      yourPrs: 'newest-first',
      relatedToYou: 'repo-az',
      stalePrs: 'line-changes-desc',
    }
    mockStorage.set(STORAGE_KEYS.sectionSort, JSON.stringify(stored))
    const result = readSectionSortPreferences()
    expect(result.needsAttention).toBe('oldest-first')
    expect(result.yourPrs).toBe('newest-first')
    expect(result.relatedToYou).toBe('repo-az')
    expect(result.stalePrs).toBe('line-changes-desc')
  })

  it('should return all defaults when no preferences are stored', () => {
    const result = readSectionSortPreferences()
    expect(result.needsAttention).toBe('default')
    expect(result.yourPrs).toBe('default')
    expect(result.relatedToYou).toBe('default')
    expect(result.stalePrs).toBe('default')
  })

  it('should return all defaults on parse error', () => {
    mockStorage.set(STORAGE_KEYS.sectionSort, 'not valid json')
    const result = readSectionSortPreferences()
    expect(result.needsAttention).toBe('default')
    expect(result.yourPrs).toBe('default')
    expect(result.relatedToYou).toBe('default')
    expect(result.stalePrs).toBe('default')
  })
})

describe('readSectionFilterPreferences', () => {
  beforeEach(() => {
    mockStorage.clear()
    vi.clearAllMocks()
  })

  it('should return all-empty defaults when no key in localStorage', () => {
    const result = readSectionFilterPreferences()
    expect(result.needsAttention.repository.size).toBe(0)
    expect(result.needsAttention.checkStatus.size).toBe(0)
    expect(result.needsAttention.labels.size).toBe(0)
    expect(result.needsAttention.author.size).toBe(0)
    expect(result.yourPrs.repository.size).toBe(0)
    expect(result.relatedToYou.repository.size).toBe(0)
    expect(result.stalePrs.repository.size).toBe(0)
  })

  it('should correctly convert arrays back to Sets from valid JSON', () => {
    const stored = {
      needsAttention: {
        repository: ['repo1', 'repo2'],
        checkStatus: ['passing'],
        labels: ['bug'],
        author: ['alice'],
      },
      yourPrs: {
        repository: [],
        checkStatus: [],
        labels: [],
        author: [],
      },
      relatedToYou: {
        repository: ['repo3'],
        checkStatus: ['failing', 'pending'],
        labels: [],
        author: ['bob', 'charlie'],
      },
      stalePrs: {
        repository: [],
        checkStatus: [],
        labels: ['wontfix'],
        author: [],
      },
    }
    mockStorage.set(STORAGE_KEYS.sectionFilters, JSON.stringify(stored))
    const result = readSectionFilterPreferences()
    expect(result.needsAttention.repository).toEqual(new Set(['repo1', 'repo2']))
    expect(result.needsAttention.checkStatus).toEqual(new Set(['passing']))
    expect(result.needsAttention.labels).toEqual(new Set(['bug']))
    expect(result.needsAttention.author).toEqual(new Set(['alice']))
    expect(result.relatedToYou.repository).toEqual(new Set(['repo3']))
    expect(result.relatedToYou.checkStatus).toEqual(new Set(['failing', 'pending']))
    expect(result.relatedToYou.author).toEqual(new Set(['bob', 'charlie']))
  })

  it('should return defaults on corrupted JSON', () => {
    mockStorage.set(STORAGE_KEYS.sectionFilters, 'not valid json')
    const result = readSectionFilterPreferences()
    expect(result.needsAttention.repository.size).toBe(0)
    expect(result.yourPrs.checkStatus.size).toBe(0)
    expect(result.relatedToYou.labels.size).toBe(0)
    expect(result.stalePrs.author.size).toBe(0)
  })
})

describe('writeSectionFilterPreferences', () => {
  beforeEach(() => {
    mockStorage.clear()
    vi.clearAllMocks()
  })

  it('should round-trip: write then read returns identical Sets', () => {
    const original: Record<string, any> = {
      needsAttention: {
        repository: new Set(['repo1', 'repo2']),
        checkStatus: new Set(['passing']),
        labels: new Set(['bug']),
        author: new Set(['alice']),
      },
      yourPrs: {
        repository: new Set(),
        checkStatus: new Set(),
        labels: new Set(),
        author: new Set(),
      },
      relatedToYou: {
        repository: new Set(['repo3']),
        checkStatus: new Set(['failing']),
        labels: new Set(),
        author: new Set(['bob']),
      },
      stalePrs: {
        repository: new Set(),
        checkStatus: new Set(),
        labels: new Set(['wontfix']),
        author: new Set(),
      },
    }
    writeSectionFilterPreferences(original)
    const read = readSectionFilterPreferences()
    expect(read.needsAttention.repository).toEqual(new Set(['repo1', 'repo2']))
    expect(read.needsAttention.checkStatus).toEqual(new Set(['passing']))
    expect(read.needsAttention.labels).toEqual(new Set(['bug']))
    expect(read.needsAttention.author).toEqual(new Set(['alice']))
    expect(read.yourPrs.repository).toEqual(new Set())
    expect(read.relatedToYou.repository).toEqual(new Set(['repo3']))
    expect(read.stalePrs.labels).toEqual(new Set(['wontfix']))
  })
})
