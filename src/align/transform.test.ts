import { describe, expect, it } from 'vitest'
import type { Transform } from '@/types'
import {
  IDENTITY,
  MAX_ROTATION,
  clampToCover,
  rotatedFrameBounds,
  scaleMin,
  toMatrix,
} from './transform'

const FRAME = { width: 100, height: 150 }

describe('rotatedFrameBounds', () => {
  it('rend le cadre inchangé sans rotation', () => {
    expect(rotatedFrameBounds(FRAME, 0)).toEqual({ width: 100, height: 150 })
  })

  it('échange les côtés à 90°', () => {
    const bounds = rotatedFrameBounds(FRAME, Math.PI / 2)
    expect(bounds.width).toBeCloseTo(150)
    expect(bounds.height).toBeCloseTo(100)
  })

  it('grandit dans les deux axes à 45°', () => {
    const bounds = rotatedFrameBounds(FRAME, Math.PI / 4)
    const expected = (100 + 150) / Math.SQRT2
    expect(bounds.width).toBeCloseTo(expected)
    expect(bounds.height).toBeCloseTo(expected)
  })
})

describe('scaleMin', () => {
  it('vaut 1 quand la photo a exactement la taille du cadre', () => {
    expect(scaleMin(FRAME, FRAME, 0)).toBeCloseTo(1)
  })

  it('vaut le rapport du côté contraignant quand la photo est plus petite', () => {
    // Le cadre fait 100x150, la photo 50x100 : il faut 2 en largeur, 1.5 en hauteur.
    expect(scaleMin(FRAME, { width: 50, height: 100 }, 0)).toBeCloseTo(2)
  })

  it('descend sous 1 quand la photo est plus grande que le cadre', () => {
    expect(scaleMin(FRAME, { width: 200, height: 300 }, 0)).toBeCloseTo(0.5)
  })

  it('augmente avec la rotation', () => {
    expect(scaleMin(FRAME, FRAME, MAX_ROTATION)).toBeGreaterThan(1)
  })
})

describe('clampToCover', () => {
  const shot = { width: 200, height: 300 }

  it('laisse une transformation déjà valide intacte', () => {
    const t: Transform = { scale: 1, rotation: 0, tx: 10, ty: -20 }
    expect(clampToCover(t, shot, FRAME)).toEqual(t)
  })

  it('remonte une échelle trop faible jusqu à scaleMin', () => {
    const result = clampToCover({ ...IDENTITY, scale: 0.1 }, shot, FRAME)
    expect(result.scale).toBeCloseTo(scaleMin(FRAME, shot, 0))
  })

  it('borne la rotation à ±MAX_ROTATION', () => {
    expect(clampToCover({ ...IDENTITY, rotation: 1 }, shot, FRAME).rotation).toBeCloseTo(MAX_ROTATION)
    expect(clampToCover({ ...IDENTITY, rotation: -1 }, shot, FRAME).rotation).toBeCloseTo(-MAX_ROTATION)
  })

  it('borne la translation au jeu disponible', () => {
    // Photo 200x300 à l échelle 1 dans un cadre 100x150 : 50 px de jeu horizontal, 75 vertical.
    const result = clampToCover({ scale: 1, rotation: 0, tx: 999, ty: -999 }, shot, FRAME)
    expect(result.tx).toBeCloseTo(50)
    expect(result.ty).toBeCloseTo(-75)
  })

  it('annule la translation quand il n y a aucun jeu', () => {
    const result = clampToCover({ scale: 1, rotation: 0, tx: 30, ty: 30 }, FRAME, FRAME)
    expect(result.tx).toBeCloseTo(0)
    expect(result.ty).toBeCloseTo(0)
  })

  it('borne la translation dans le repère tourné de la photo', () => {
    const rotation = MAX_ROTATION
    const result = clampToCover({ scale: 1.4, rotation, tx: 999, ty: 0 }, shot, FRAME)
    // Le point clampé, ramené dans le repère de la photo, doit tenir dans le jeu.
    const bounds = rotatedFrameBounds(FRAME, rotation)
    const slackX = (1.4 * shot.width - bounds.width) / 2
    const inShotFrame =
      result.tx * Math.cos(-rotation) - result.ty * Math.sin(-rotation)
    expect(inShotFrame).toBeCloseTo(slackX)
  })

  it('est idempotente', () => {
    const once = clampToCover({ scale: 0.2, rotation: 2, tx: 500, ty: 500 }, shot, FRAME)
    expect(clampToCover(once, shot, FRAME)).toEqual(once)
  })
})

describe('toMatrix', () => {
  it('rend la matrice identité quand la photo remplit exactement le cadre', () => {
    const m = toMatrix(IDENTITY, FRAME, FRAME)
    expect(m.a).toBeCloseTo(1)
    expect(m.b).toBeCloseTo(0)
    expect(m.c).toBeCloseTo(0)
    expect(m.d).toBeCloseTo(1)
    expect(m.e).toBeCloseTo(0)
    expect(m.f).toBeCloseTo(0)
  })

  it('centre une photo plus large que le cadre', () => {
    const m = toMatrix(IDENTITY, FRAME, { width: 200, height: 150 })
    expect(m.e).toBeCloseTo(-50)
    expect(m.f).toBeCloseTo(0)
  })

  it('applique la translation après la rotation', () => {
    const m = toMatrix({ scale: 1, rotation: 0, tx: 7, ty: -3 }, FRAME, FRAME)
    expect(m.e).toBeCloseTo(7)
    expect(m.f).toBeCloseTo(-3)
  })
})
