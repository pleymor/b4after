import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLASH_MS, isFlashing, subscribeFlash, triggerFlash } from './flash'

describe('flash', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    // Purger le minuteur en cours : le magasin est un module partagé, un flash laissé
    // actif fuirait dans le test suivant.
    vi.runAllTimers()
    vi.useRealTimers()
  })

  it('s active à la tape puis s éteint tout seul', () => {
    expect(isFlashing()).toBe(false)

    triggerFlash()
    expect(isFlashing()).toBe(true)

    vi.advanceTimersByTime(FLASH_MS - 1)
    expect(isFlashing()).toBe(true)
    vi.advanceTimersByTime(1)
    expect(isFlashing()).toBe(false)
  })

  it('notifie les abonnés à l allumage et à l extinction', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeFlash(listener)

    triggerFlash()
    expect(listener).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(FLASH_MS)
    expect(listener).toHaveBeenCalledTimes(2)

    unsubscribe()
    triggerFlash()
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('repart de zéro quand deux prises se suivent', () => {
    triggerFlash()
    vi.advanceTimersByTime(FLASH_MS - 20)
    triggerFlash()

    // Le minuteur de la première prise ne doit pas éteindre le flash de la seconde.
    vi.advanceTimersByTime(20)
    expect(isFlashing()).toBe(true)
    vi.advanceTimersByTime(FLASH_MS)
    expect(isFlashing()).toBe(false)
  })
})
