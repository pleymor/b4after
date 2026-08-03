import { describe, expect, it } from 'vitest'
import { IDENTITY, MAX_ROTATION } from './transform'
import { createGestureState, gestureReducer, type GestureEvent } from './gesture'

const SHOT = { width: 400, height: 600 }
const FRAME = { width: 100, height: 150 }

function run(events: GestureEvent[], start = IDENTITY) {
  return events.reduce(gestureReducer, createGestureState(start, SHOT, FRAME))
}

describe('gestureReducer', () => {
  it('part de la transformation fournie', () => {
    expect(createGestureState(IDENTITY, SHOT, FRAME).transform).toEqual(IDENTITY)
  })

  it('translate avec un doigt', () => {
    const state = run([
      { type: 'down', id: 1, x: 50, y: 50 },
      { type: 'move', id: 1, x: 60, y: 40 },
    ])
    expect(state.transform.tx).toBeCloseTo(10)
    expect(state.transform.ty).toBeCloseTo(-10)
  })

  it('ignore le déplacement d un pointeur jamais posé', () => {
    const state = run([{ type: 'move', id: 9, x: 60, y: 40 }])
    expect(state.transform).toEqual(IDENTITY)
  })

  it('met à l échelle avec deux doigts qui s écartent', () => {
    const state = run([
      { type: 'down', id: 1, x: 40, y: 75 },
      { type: 'down', id: 2, x: 60, y: 75 },
      { type: 'move', id: 1, x: 30, y: 75 },
      { type: 'move', id: 2, x: 70, y: 75 },
    ])
    // L écartement double : 20 px puis 40 px.
    expect(state.transform.scale).toBeCloseTo(2)
  })

  it('pivote avec deux doigts', () => {
    const state = run([
      { type: 'down', id: 1, x: 40, y: 75 },
      { type: 'down', id: 2, x: 60, y: 75 },
      // Le segment passe de l horizontale à la verticale : +90°, clampé à MAX_ROTATION.
      { type: 'move', id: 1, x: 50, y: 65 },
      { type: 'move', id: 2, x: 50, y: 85 },
    ])
    expect(state.transform.rotation).toBeCloseTo(MAX_ROTATION)
  })

  it('ne saute pas quand un deuxième doigt se pose', () => {
    const state = run([
      { type: 'down', id: 1, x: 50, y: 75 },
      { type: 'move', id: 1, x: 60, y: 75 },
      { type: 'down', id: 2, x: 80, y: 75 },
    ])
    expect(state.transform.tx).toBeCloseTo(10)
  })

  it('ne saute pas quand un doigt se lève', () => {
    const state = run([
      { type: 'down', id: 1, x: 40, y: 75 },
      { type: 'down', id: 2, x: 60, y: 75 },
      { type: 'up', id: 2 },
      { type: 'move', id: 1, x: 45, y: 75 },
    ])
    expect(state.transform.tx).toBeCloseTo(5)
    expect(state.transform.scale).toBeCloseTo(1)
  })

  it('applique la contrainte de couverture pendant le geste', () => {
    // La photo fait 4x le cadre : à l échelle 1 le jeu horizontal est de 150 px.
    const state = run([
      { type: 'down', id: 1, x: 0, y: 75 },
      { type: 'move', id: 1, x: 9999, y: 75 },
    ])
    expect(state.transform.tx).toBeCloseTo(150)
  })

  it('ne descend jamais sous scaleMin en pinçant', () => {
    const state = run([
      { type: 'down', id: 1, x: 40, y: 75 },
      { type: 'down', id: 2, x: 60, y: 75 },
      { type: 'move', id: 1, x: 49, y: 75 },
      { type: 'move', id: 2, x: 51, y: 75 },
    ])
    expect(state.transform.scale).toBeCloseTo(0.25)
  })
})
