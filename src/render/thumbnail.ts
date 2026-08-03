import type { Size } from '@/types'
import type { Drawable } from './drawShot'
import { toJpegBlob } from './toJpegBlob'

export const THUMB_MAX_EDGE = 320
export const THUMB_QUALITY = 0.7

/** Facteur de réduction pour tenir dans `maxEdge`, sans jamais agrandir. */
export function fitFactor(size: Size, maxEdge: number): number {
  return Math.min(1, maxEdge / Math.max(size.width, size.height))
}

export async function makeThumbnail(source: Drawable, shot: Size): Promise<Blob> {
  const factor = fitFactor(shot, THUMB_MAX_EDGE)
  return toJpegBlob(
    source,
    { width: Math.round(shot.width * factor), height: Math.round(shot.height * factor) },
    THUMB_QUALITY,
  )
}
