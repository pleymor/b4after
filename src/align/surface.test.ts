import { describe, expect, it } from 'vitest'
import { toFrameCoords } from './surface'

const FRAME = { width: 300, height: 400 }

describe('toFrameCoords', () => {
  it('rend le point inchangé quand la surface fait la taille du cadre', () => {
    const rect = { left: 0, top: 0, width: 300, height: 400 }
    expect(toFrameCoords({ x: 30, y: 40 }, rect, FRAME)).toEqual({ x: 30, y: 40 })
  })

  it('soustrait l origine de la surface', () => {
    const rect = { left: 10, top: 20, width: 300, height: 400 }
    expect(toFrameCoords({ x: 40, y: 60 }, rect, FRAME)).toEqual({ x: 30, y: 40 })
  })

  it('met à l échelle quand la surface est plus petite que le cadre', () => {
    const rect = { left: 0, top: 0, width: 150, height: 200 }
    expect(toFrameCoords({ x: 30, y: 40 }, rect, FRAME)).toEqual({ x: 60, y: 80 })
  })

  it('utilise un ratio par axe quand le rapport d aspect diffère de celui du cadre', () => {
    // Surface comprimée verticalement : 150 de large pour 100 de haut, alors que le
    // cadre est en 300x400. Un ratio unique dérivé de la largeur donnerait y = 80 ;
    // le bon résultat est 160.
    const rect = { left: 0, top: 0, width: 150, height: 100 }
    expect(toFrameCoords({ x: 30, y: 40 }, rect, FRAME)).toEqual({ x: 60, y: 160 })
  })

  it('rend l origine pour une surface de taille nulle', () => {
    expect(toFrameCoords({ x: 30, y: 40 }, { left: 0, top: 0, width: 0, height: 0 }, FRAME)).toEqual(
      { x: 0, y: 0 },
    )
  })
})
