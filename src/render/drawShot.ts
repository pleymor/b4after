import { toMatrix } from '@/align/transform'
import type { Size, Transform } from '@/types'

export type Drawable = ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas
export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/**
 * Dessine une photo dans le cadre canonique. Unique primitive de dessin de l app :
 * l aperçu et les exports passent par elle, donc ce qu on voit est ce qu on exporte.
 */
export function drawShot(
  ctx: Ctx,
  source: Drawable,
  transform: Transform,
  frame: Size,
  shot: Size,
): void {
  const m = toMatrix(transform, frame, shot)
  ctx.save()
  // `transform` compose au lieu de remplacer : l appelant peut donc translater ou
  // découper le contexte avant d appeler, ce dont l export côte-à-côte a besoin
  // pour placer ses deux cellules.
  ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f)
  ctx.drawImage(source, 0, 0, shot.width, shot.height)
  ctx.restore()
}
