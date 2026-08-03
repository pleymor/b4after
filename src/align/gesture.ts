import type { Size, Transform } from '@/types'
import { clampToCover } from './transform'

export type GesturePoint = { x: number; y: number }

export type GestureEvent =
  | { type: 'down'; id: number; x: number; y: number }
  | { type: 'move'; id: number; x: number; y: number }
  | { type: 'up'; id: number }

type Baseline = {
  transform: Transform
  centroid: GesturePoint
  distance: number
  angle: number
}

export type GestureState = {
  transform: Transform
  /** Pointeurs actifs, en pixels du cadre canonique. */
  pointers: Record<number, GesturePoint>
  baseline: Baseline | null
  shot: Size
  frame: Size
}

function centroidOf(pointers: GesturePoint[]): GesturePoint {
  const sum = pointers.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 })
  return { x: sum.x / pointers.length, y: sum.y / pointers.length }
}

/** Distance et angle du segment formé par les deux premiers pointeurs. */
function spanOf(pointers: GesturePoint[]): { distance: number; angle: number } {
  if (pointers.length < 2) return { distance: 0, angle: 0 }
  const dx = pointers[1].x - pointers[0].x
  const dy = pointers[1].y - pointers[0].y
  return { distance: Math.hypot(dx, dy), angle: Math.atan2(dy, dx) }
}

/**
 * Fige l état courant comme nouvelle référence du geste. Appelé à chaque pose et
 * chaque lever de doigt : sans ce rebasage, le nombre de pointeurs changerait de
 * dénominateur et l image sauterait.
 */
function rebase(state: GestureState): GestureState {
  const points = Object.values(state.pointers)
  if (points.length === 0) return { ...state, baseline: null }
  return {
    ...state,
    baseline: { transform: state.transform, centroid: centroidOf(points), ...spanOf(points) },
  }
}

export function createGestureState(
  transform: Transform,
  shot: Size,
  frame: Size,
): GestureState {
  return { transform, pointers: {}, baseline: null, shot, frame }
}

export function gestureReducer(state: GestureState, event: GestureEvent): GestureState {
  if (event.type === 'down') {
    const pointers = { ...state.pointers, [event.id]: { x: event.x, y: event.y } }
    return rebase({ ...state, pointers })
  }

  if (event.type === 'up') {
    const pointers = { ...state.pointers }
    delete pointers[event.id]
    return rebase({ ...state, pointers })
  }

  if (!(event.id in state.pointers) || !state.baseline) return state

  const pointers = { ...state.pointers, [event.id]: { x: event.x, y: event.y } }
  const points = Object.values(pointers)
  const { baseline } = state

  const centroid = centroidOf(points)
  const span = spanOf(points)

  const scaleFactor =
    points.length >= 2 && baseline.distance > 0 ? span.distance / baseline.distance : 1
  const rotationDelta = points.length >= 2 ? span.angle - baseline.angle : 0

  const next: Transform = {
    scale: baseline.transform.scale * scaleFactor,
    rotation: baseline.transform.rotation + rotationDelta,
    tx: baseline.transform.tx + (centroid.x - baseline.centroid.x),
    ty: baseline.transform.ty + (centroid.y - baseline.centroid.y),
  }

  return { ...state, pointers, transform: clampToCover(next, state.shot, state.frame) }
}
