import type { Size } from '@/types'
import type { Drawable } from './drawShot'

/** Dessine une source aux dimensions voulues dans un canvas hors écran, rend un JPEG. */
export async function toJpegBlob(
  source: Drawable,
  size: Size,
  quality: number,
): Promise<Blob> {
  const canvas = new OffscreenCanvas(size.width, size.height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Contexte 2D indisponible')
  ctx.drawImage(source, 0, 0, size.width, size.height)
  return canvas.convertToBlob({ type: 'image/jpeg', quality })
}
