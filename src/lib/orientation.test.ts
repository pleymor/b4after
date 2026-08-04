import { describe, expect, it } from 'vitest'
import { needsRotationHint } from './orientation'

describe('needsRotationHint', () => {
  it('ne suggère rien quand les deux sont en portrait', () => {
    expect(needsRotationHint({ width: 400, height: 900 }, { width: 300, height: 400 })).toBe(false)
  })

  it('ne suggère rien quand les deux sont en paysage', () => {
    expect(needsRotationHint({ width: 900, height: 400 }, { width: 400, height: 300 })).toBe(false)
  })

  it('suggère de tourner quand les orientations diffèrent', () => {
    expect(needsRotationHint({ width: 900, height: 400 }, { width: 300, height: 400 })).toBe(true)
    expect(needsRotationHint({ width: 400, height: 900 }, { width: 400, height: 300 })).toBe(true)
  })

  it('ne suggère rien pour un cadre carré', () => {
    expect(needsRotationHint({ width: 900, height: 400 }, { width: 300, height: 300 })).toBe(false)
  })
})
