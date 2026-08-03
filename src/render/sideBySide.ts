import { formatDate } from '@/lib/format'
import type { Size, Transform } from '@/types'
import { drawShot, type Drawable } from './drawShot'
import { fitFactor } from './thumbnail'

export const EXPORT_MAX_EDGE = 2048
export const EXPORT_QUALITY = 0.85
export const GUTTER = 8

export type ComparisonInput = {
  source: Drawable
  transform: Transform
  takenAt: number
  /** Dimensions natives de la photo, pas celles du cadre. */
  shot: Size
}

export async function renderSideBySide(
  before: ComparisonInput,
  after: ComparisonInput,
  frame: Size,
  options: { showDates: boolean },
): Promise<Blob> {
  const factor = fitFactor(frame, EXPORT_MAX_EDGE)
  const cellWidth = Math.round(frame.width * factor)
  const cellHeight = Math.round(frame.height * factor)
  const bandHeight = options.showDates ? Math.round(cellWidth * 0.14) : 0

  // Un cadre en portrait se lit mieux côte à côte, un cadre en paysage empilé.
  const horizontal = frame.height > frame.width

  const canvas = new OffscreenCanvas(
    horizontal ? cellWidth * 2 + GUTTER : cellWidth,
    horizontal ? cellHeight + bandHeight : (cellHeight + bandHeight) * 2 + GUTTER,
  )
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Contexte 2D indisponible')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const cells = [before, after].map((input, index) => ({
    input,
    x: horizontal ? index * (cellWidth + GUTTER) : 0,
    y: horizontal ? 0 : index * (cellHeight + bandHeight + GUTTER),
  }))

  for (const { input, x, y } of cells) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, cellWidth, cellHeight)
    ctx.clip()
    ctx.translate(x, y)
    // Le cadre est passé à l échelle d export : la transformation stockée est en
    // pixels du cadre canonique, `scale` la suit donc proportionnellement.
    drawShot(
      ctx,
      input.source,
      { ...input.transform, tx: input.transform.tx * factor, ty: input.transform.ty * factor },
      { width: cellWidth, height: cellHeight },
      { width: input.shot.width * factor, height: input.shot.height * factor },
    )
    ctx.restore()

    if (options.showDates) {
      ctx.fillStyle = '#0f172a'
      ctx.fillRect(x, y + cellHeight, cellWidth, bandHeight)
      ctx.fillStyle = '#f1f5f9'
      ctx.font = `${Math.round(bandHeight * 0.62)}px sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(formatDate(input.takenAt), x + cellWidth / 2, y + cellHeight + bandHeight / 2)
    }
  }

  return canvas.convertToBlob({ type: 'image/jpeg', quality: EXPORT_QUALITY })
}
