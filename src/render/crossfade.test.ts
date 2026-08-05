import { describe, expect, it } from 'vitest'
import { IDENTITY } from '@/align/transform'
import { scaleInput, targetWidth, transitionSteps } from './crossfade'

describe('transitionSteps', () => {
  it('garde le rythme du fondu actuel', () => {
    // GIF_STEPS (10) frames dont deux sont les paliers immobiles : il reste 8 frames
    // de transition. Changer ce nombre changerait la durée de tous les exports.
    expect(transitionSteps('crossfade')).toBe(8)
  })

  it('donne au balayage le même rythme qu au fondu', () => {
    expect(transitionSteps('wipe')).toBe(8)
  })

  it('ne dépense aucune frame pour une coupe franche', () => {
    // Une coupe n a pas d états intermédiaires : les frames qui les figureraient
    // seraient du poids de fichier pour rien.
    expect(transitionSteps('cut')).toBe(0)
  })
})

describe('scaleInput', () => {
  it('met la translation et les dimensions à l échelle, pas la source', () => {
    const source = {} as never
    const input = {
      source,
      transform: { ...IDENTITY, tx: 100, ty: -40 },
      takenAt: 123,
      shot: { width: 1200, height: 1600 },
    }

    const scaled = scaleInput(input, 0.5)

    expect(scaled.transform).toEqual({ ...IDENTITY, tx: 50, ty: -20 })
    expect(scaled.shot).toEqual({ width: 600, height: 800 })
    expect(scaled.source).toBe(source)
    // `takenAt` ne sert qu au bandeau de l image côte-à-côte : il n a rien à faire
    // dans une entrée de rendu animé.
    expect(scaled).not.toHaveProperty('takenAt')
  })
})

describe('targetWidth', () => {
  it('rend la largeur demandée', () => {
    expect(targetWidth(640, { width: 1200, height: 1600 })).toBe(640)
    expect(targetWidth(1080, { width: 1200, height: 1600 })).toBe(1080)
  })

  it('rend la largeur du cadre en pleine résolution', () => {
    expect(targetWidth('full', { width: 1200, height: 1600 })).toBe(1200)
  })

  it('plafonne la pleine résolution à EXPORT_MAX_EDGE', () => {
    // Un cadre de 4000 px n a pas à produire une vidéo de 4000 px de large : le
    // plafond est le même que celui de l export JPEG.
    expect(targetWidth('full', { width: 4000, height: 3000 })).toBe(2048)
  })
})
