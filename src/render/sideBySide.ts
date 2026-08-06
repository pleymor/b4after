import type { ImageOptions, ImageWidth } from '@/lib/exportOptions'
import { formatDate, formatDateTime } from '@/lib/format'
import type { Size, Transform } from '@/types'
import { drawShot } from './drawShot'
import { fitFactor } from './thumbnail'

// Défaut historique du plafond par photo, devenu la valeur par défaut de l option
// « Largeur » plutôt qu une constante imposée (voir la spec de comparaison de série).
export const EXPORT_MAX_EDGE = 2048
export const EXPORT_QUALITY = 0.85
export const GUTTER = 8

export type ComparisonInput = {
  /** JPEG plein format, tel que stocké. Le rendu le décode lui-même, une photo à la
   * fois, pour ne jamais garder tout un défilé de bitmaps en mémoire à la fois. */
  blob: Blob
  transform: Transform
  takenAt: number
  /** Dimensions natives de la photo, pas celles du cadre. */
  shot: Size
}

/** Plafond par photo en pixels pour la largeur d image choisie ; `'full'` ne plafonne pas. */
export function imageWidthCap(width: ImageWidth): number {
  return width === 'full' ? Infinity : width
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

/**
 * Accole les `N` photos d une série dans l ordre, séparées par `GUTTER` px. Le
 * plafond de résolution reste par photo, pas sur l image composée (voir la spec de
 * comparaison de série) : une bande de cinq photos portrait à 2048 px par photo fait
 * donc près de 8000 px de large — le choix assumé de privilégier le détail.
 *
 * Décode une photo à la fois (`createImageBitmap`, puis `bitmap.close()` avant de
 * passer à la suivante) : jamais plus d une photo pleine résolution en mémoire, quelle
 * que soit la longueur de la série (voir la spec, § Mémoire).
 */
export async function renderSideBySide(
  inputs: ComparisonInput[],
  frame: Size,
  options: ImageOptions,
  // Séparé des `ImageOptions` et non persisté : ce n est pas un réglage utilisateur
  // mais le point d entrée qui permet à l aperçu de demander un rendu réduit (480 px)
  // tout en partageant exactement le même code que l export. Le défaut suit le
  // réglage « Largeur » de l utilisateur (2048 px par défaut), qui reproduit le
  // comportement d avant l existence de ce réglage.
  maxEdge: number = imageWidthCap(options.width),
): Promise<Blob> {
  const factor = fitFactor(frame, maxEdge)
  const cellWidth = Math.round(frame.width * factor)
  const cellHeight = Math.round(frame.height * factor)
  const showStamp = options.stamp !== 'none'
  const bandHeight = showStamp ? Math.round(cellWidth * 0.14 * options.stampScale) : 0
  const count = inputs.length

  // `'auto'` conserve la règle d origine : un cadre en portrait se lit mieux côte à
  // côte, un cadre en paysage empilé.
  const horizontal =
    options.layout === 'auto' ? frame.height > frame.width : options.layout === 'horizontal'

  const canvas = new OffscreenCanvas(
    horizontal ? cellWidth * count + GUTTER * (count - 1) : cellWidth,
    horizontal ? cellHeight + bandHeight : (cellHeight + bandHeight) * count + GUTTER * (count - 1),
  )
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Contexte 2D indisponible')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const cells = inputs.map((input, index) => ({
    input,
    x: horizontal ? index * (cellWidth + GUTTER) : 0,
    y: horizontal ? 0 : index * (cellHeight + bandHeight + GUTTER),
  }))

  for (const { input, x, y } of cells) {
    const scaledShot = { width: input.shot.width * factor, height: input.shot.height * factor }
    // Décodé à la taille réellement dessinée, jamais plus : voir `decodeScaled` dans
    // crossfade.ts pour le même principe côté vidéo et GIF.
    const bitmap = await createImageBitmap(input.blob, {
      resizeWidth: Math.max(1, Math.round(scaledShot.width)),
      resizeQuality: 'medium',
    })
    try {
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, cellWidth, cellHeight)
      ctx.clip()
      ctx.translate(x, y)
      // Le cadre est passé à l échelle d export : la transformation stockée est en
      // pixels du cadre canonique, `scale` la suit donc proportionnellement.
      drawShot(
        ctx,
        bitmap,
        { ...input.transform, tx: input.transform.tx * factor, ty: input.transform.ty * factor },
        { width: cellWidth, height: cellHeight },
        scaledShot,
      )
      ctx.restore()
    } finally {
      bitmap.close()
    }

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
