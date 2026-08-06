import { describe, expect, it } from 'vitest'
import { videoDurationMs } from './video'

describe('videoDurationMs', () => {
  it('deux photos aux réglages par défaut : 2 paliers de 1200 ms + 1 fondu de 1200 ms = 3600 ms', () => {
    expect(
      videoDurationMs(2, { transition: 'crossfade', width: 640, hold: 'medium', pace: 'normal' }),
    ).toBe(3600)
  })

  it('six photos aux réglages par défaut : 6 paliers de 1200 ms + 5 fondus de 1200 ms = 13200 ms', () => {
    expect(
      videoDurationMs(6, { transition: 'crossfade', width: 640, hold: 'medium', pace: 'normal' }),
    ).toBe(13200)
  })

  it('une coupe franche retire entièrement le terme de fondu, quel que soit le rythme', () => {
    // 2 photos, palier long (2000 ms) : 2 * 2000 = 4000 ms. Sans la coupe, le fondu
    // lent (1800 ms) ajouterait 1800 ms de plus, pour 5800 ms.
    expect(videoDurationMs(2, { transition: 'cut', width: 640, hold: 'long', pace: 'slow' })).toBe(
      4000,
    )
  })
})
