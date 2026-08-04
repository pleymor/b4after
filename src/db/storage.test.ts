import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ensurePersistence,
  formatBytes,
  getStorageEstimate,
  isQuotaError,
  resetPersistenceForTests,
} from './storage'

afterEach(() => {
  vi.unstubAllGlobals()
  resetPersistenceForTests()
})

describe('ensurePersistence', () => {
  it('ne demande la persistance qu une fois', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { storage: { persist, persisted: async () => false } })

    expect(await ensurePersistence()).toBe(true)
    expect(await ensurePersistence()).toBe(true)
    expect(persist).toHaveBeenCalledTimes(1)
  })

  it('ne redemande rien quand la persistance est déjà acquise', async () => {
    const persist = vi.fn()
    vi.stubGlobal('navigator', { storage: { persist, persisted: async () => true } })

    expect(await ensurePersistence()).toBe(true)
    expect(persist).not.toHaveBeenCalled()
  })

  it('renvoie faux sans planter quand l API est absente', async () => {
    vi.stubGlobal('navigator', {})
    expect(await ensurePersistence()).toBe(false)
  })

  it('renvoie faux sans planter quand la demande échoue', async () => {
    vi.stubGlobal('navigator', {
      storage: { persist: vi.fn().mockRejectedValue(new Error('non')), persisted: async () => false },
    })
    expect(await ensurePersistence()).toBe(false)
  })
})

describe('getStorageEstimate', () => {
  it('normalise les valeurs manquantes à zéro', async () => {
    vi.stubGlobal('navigator', { storage: { estimate: async () => ({ usage: 1024 }) } })
    expect(await getStorageEstimate()).toEqual({ usage: 1024, quota: 0 })
  })

  it('renvoie null quand l API est absente', async () => {
    vi.stubGlobal('navigator', {})
    expect(await getStorageEstimate()).toBeNull()
  })
})

describe('isQuotaError', () => {
  it('reconnaît QuotaExceededError', () => {
    expect(isQuotaError(new DOMException('plein', 'QuotaExceededError'))).toBe(true)
  })

  it('reconnaît le nom historique de Firefox', () => {
    expect(isQuotaError(new DOMException('plein', 'NS_ERROR_DOM_QUOTA_REACHED'))).toBe(true)
  })

  it('ignore les autres erreurs', () => {
    expect(isQuotaError(new Error('boom'))).toBe(false)
    expect(isQuotaError(null)).toBe(false)
  })
})

describe('formatBytes', () => {
  it('formate en unités lisibles', () => {
    expect(formatBytes(0)).toBe('0 o')
    expect(formatBytes(512)).toBe('512 o')
    expect(formatBytes(1024 * 1024 * 12.4)).toBe('12,4 Mo')
    expect(formatBytes(1024 ** 3 * 2)).toBe('2 Go')
  })
})
