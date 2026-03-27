import { describe, expect, it, beforeEach, vi } from 'vitest'

import { readSectionSortPreferences } from './storage'
import { STORAGE_KEYS } from '../constants'

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
