import type { Size } from '@/types'
import type { Drawable } from './drawShot'
import { makeThumbnail } from './thumbnail'
import { toJpegBlob } from './toJpegBlob'

export const CAPTURE_QUALITY = 0.9

export type EncodedFrame = { blob: Blob; thumbBlob: Blob }

/**
 * Encode une prise en JPEG pleine taille et en vignette, pour l écriture en base.
 *
 * Part de la source saisie plutôt que du JPEG plein format : la vignette n a donc plus
 * besoin d un `createImageBitmap` intermédiaire, qui décodait entièrement ce qui venait
 * d être encodé. Les deux encodages sont lancés ensemble, aucun ne dépendant de l autre.
 */
export async function encodeFrame(source: Drawable, size: Size): Promise<EncodedFrame> {
  const [blob, thumbBlob] = await Promise.all([
    toJpegBlob(source, size, CAPTURE_QUALITY),
    makeThumbnail(source, size),
  ])
  return { blob, thumbBlob }
}
