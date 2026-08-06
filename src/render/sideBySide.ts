import type { ImageOptions } from '@/lib/exportOptions'
import { formatDate, formatDateTime } from '@/lib/format'
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

/**
 * Plus grande taille ≤ `startSize` pour laquelle `measure` rend une largeur qui tient
 * dans `maxWidth`, avec un plancher à 6 px.
 *
 * Filet de sécurité : pour le format actuel, la taille naturelle tient toujours — la
 * police et la limite sont toutes deux linéaires en largeur de cellule, leur rapport
 * est donc invariant d échelle. Ce qui est couvert ici, c est une chaîne future plus
 * longue ou une police plus large, pas le cas nominal.
 */
export function fittedFontSize(
  measure: (size: number) => number,
  maxWidth: number,
  startSize: number,
): number {
  const natural = measure(startSize)
  if (natural <= maxWidth) return startSize

  // Corps fractionnaire, et non le plus grand entier qui tient : un corps entier
  // n est pas invariant d échelle. À 20 px de départ on retiendrait floor(8,33) = 8,
  // soit un ratio de 0,400, alors qu à 100 px on retiendrait floor(41,67) = 41, soit
  // 0,410. L aperçu et l export choisiraient donc des proportions différentes, et
  // l aperçu mentirait sur le rendu final. Le canevas accepte les corps décimaux.
  //
  // Le plancher de 6 px reste absolu, donc lui n est pas invariant d échelle — mais
  // il ne s engage que sur des cas absurdes où le texte est illisible de toute façon.
  return Math.max(6, (startSize * maxWidth) / natural)
}

/**
 * Réduit le corps de la police jusqu à ce que `text` tienne dans `maxWidth`, et pose
 * la police retenue sur le contexte.
 *
 * Le corps est calculé sur la hauteur du bandeau, qui ne dit rien de la longueur du
 * texte : « JJ/MM/AAAA à HH:MM » est environ 1,7 fois plus long que la date seule et
 * déborderait d une cellule étroite.
 */
function setFittedFont(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startSize: number,
): void {
  const size = fittedFontSize(
    (candidate) => {
      ctx.font = `${candidate}px sans-serif`
      return ctx.measureText(text).width
    },
    maxWidth,
    startSize,
  )
  ctx.font = `${size}px sans-serif`
}

export async function renderSideBySide(
  before: ComparisonInput,
  after: ComparisonInput,
  frame: Size,
  options: ImageOptions,
  // Séparé des `ImageOptions` et non persisté : ce n est pas un réglage utilisateur
  // mais le point d entrée qui permet à l aperçu de demander un rendu réduit (480 px)
  // tout en partageant exactement le même code que l export (2048 px). Le défaut
  // reproduit l appel existant, donc aucun appelant actuel ne change de comportement.
  maxEdge: number = EXPORT_MAX_EDGE,
): Promise<Blob> {
  const factor = fitFactor(frame, maxEdge)
  const cellWidth = Math.round(frame.width * factor)
  const cellHeight = Math.round(frame.height * factor)
  const showStamp = options.stamp !== 'none'
  const bandHeight = showStamp ? Math.round(cellWidth * 0.14 * options.stampScale) : 0

  // `'auto'` conserve la règle d origine : un cadre en portrait se lit mieux côte à
  // côte, un cadre en paysage empilé.
  const horizontal =
    options.layout === 'auto' ? frame.height > frame.width : options.layout === 'horizontal'

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

    if (showStamp) {
      const label =
        options.stamp === 'datetime' ? formatDateTime(input.takenAt) : formatDate(input.takenAt)

      ctx.fillStyle = '#0f172a'
      ctx.fillRect(x, y + cellHeight, cellWidth, bandHeight)
      ctx.fillStyle = '#f1f5f9'
      setFittedFont(ctx, label, cellWidth * 0.92, Math.round(bandHeight * 0.62))
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, x + cellWidth / 2, y + cellHeight + bandHeight / 2)
    }
  }

  return canvas.convertToBlob({ type: 'image/jpeg', quality: EXPORT_QUALITY })
}
