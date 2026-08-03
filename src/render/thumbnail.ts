import type { Size } from '@/types'
import type { Drawable } from './drawShot'

export const THUMB_MAX_EDGE = 320
export const THUMB_QUALITY = 0.7

/** Facteur de réduction pour tenir dans `maxEdge`, sans jamais agrandir. */
export function fitFactor(size: Size, maxEdge: number): number {
  return Math.min(1, maxEdge / Math.max(size.width, size.height))
}

export async function makeThumbnail(source: Drawable, shot: Size): Promise<Blob> {
  const factor = fitFactor(shot, THUMB_MAX_EDGE)
  const width = Math.round(shot.width * factor)
  const height = Math.round(shot.height * factor)

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Contexte 2D indisponible')
  ctx.drawImage(source, 0, 0, width, height)

  return canvas.convertToBlob({ type: 'image/jpeg', quality: THUMB_QUALITY })
}
