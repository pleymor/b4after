import type { Transition, VideoWidth } from '@/lib/exportOptions'
import type { Size, Transform } from '@/types'
import { drawShot } from './drawShot'
import { GIF_STEPS } from './gif'
import { EXPORT_MAX_EDGE } from './sideBySide'
import type { ComparisonInput } from './sideBySide'

/** Une entrée de comparaison ramenée à l échelle d export, sans sa date ni son décodage. */
export type ScaledInput = {
  blob: Blob
  transform: Transform
  shot: Size
}

/**
 * Ramène une entrée à l échelle d export. La transformation stockée est en pixels du
 * cadre canonique : sa translation suit le facteur, son `scale` est déjà relatif. Le
 * blob n est pas décodé ici : c est `decodeScaled` qui le fait, une photo à la fois,
 * pour ne jamais garder tout un défilé de bitmaps pleine résolution en mémoire.
 */
export function scaleInput(input: ComparisonInput, factor: number): ScaledInput {
  return {
    blob: input.blob,
    transform: {
      ...input.transform,
      tx: input.transform.tx * factor,
      ty: input.transform.ty * factor,
    },
    shot: {
      width: input.shot.width * factor,
      height: input.shot.height * factor,
    },
  }
}

/** Une entrée décodée, prête à dessiner. À fermer (`bitmap.close()`) après usage. */
export type DecodedInput = {
  bitmap: ImageBitmap
  transform: Transform
  shot: Size
}

/**
 * Décode le bitmap d une entrée mise à l échelle. Le décodage est demandé à la taille
 * réellement dessinée (`shot`, déjà réduite par `scaleInput`) via `resizeWidth` :
 * jamais plus de pixels décodés que ce que le rendu affiche, quelle que soit la
 * résolution native de la photo (voir la spec de comparaison de série, § Mémoire).
 */
export async function decodeScaled(input: ScaledInput): Promise<DecodedInput> {
  const bitmap = await createImageBitmap(input.blob, {
    resizeWidth: Math.max(1, Math.round(input.shot.width)),
    resizeQuality: 'medium',
  })
  return { bitmap, transform: input.transform, shot: input.shot }
}

/**
 * Largeur cible en pixels pour un export animé. `'full'` prend la largeur du cadre,
 * plafonnée au même maximum que l export JPEG : un cadre de 4000 px n a pas à
 * produire une vidéo de 4000 px de large.
 */
export function targetWidth(width: VideoWidth, frame: Size): number {
  return width === 'full' ? Math.min(frame.width, EXPORT_MAX_EDGE) : width
}

/**
 * Nombre de frames intermédiaires entre les deux paliers immobiles.
 *
 * Le fondu du GIF compte `GIF_STEPS` frames dont deux sont les paliers : il reste
 * `GIF_STEPS - 2` frames de transition. Une coupe franche n en a aucune.
 */
export function transitionSteps(transition: Transition): number {
  return transition === 'cut' ? 0 : GIF_STEPS - 2
}

/** Dessine une seule entrée décodée, sans transition : le palier pur d une photo. */
export function drawSingle(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  input: DecodedInput,
  size: Size,
): void {
  ctx.clearRect(0, 0, size.width, size.height)
  drawShot(ctx, input.bitmap, input.transform, size, input.shot)
}

/**
 * Dessine l état intermédiaire `mix` (0 = avant, 1 = après) selon la transition
 * demandée. Seul endroit du code où une transition est définie : `gif.ts` et
 * `video.ts` s en servent tous les deux, et se comportent donc pareil.
 */
export function drawTransition(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  from: DecodedInput,
  to: DecodedInput,
  size: Size,
  mix: number,
  transition: Transition,
): void {
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.globalAlpha = 1

  if (transition === 'cut') {
    // Aucun état intermédiaire à représenter : on bascule à mi-course.
    const shown = mix < 0.5 ? from : to
    drawShot(ctx, shown.bitmap, shown.transform, size, shown.shot)
    return
  }

  drawShot(ctx, from.bitmap, from.transform, size, from.shot)
  if (mix <= 0) return

  if (transition === 'wipe') {
    // Une ligne qui balaie l image, comme le curseur de révélation. Au retour, `mix`
    // redescend de 1 à 0 : le balayage repart de lui-même en sens inverse.
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, size.width * mix, size.height)
    ctx.clip()
    drawShot(ctx, to.bitmap, to.transform, size, to.shot)
    ctx.restore()
    return
  }

  ctx.globalAlpha = mix
  drawShot(ctx, to.bitmap, to.transform, size, to.shot)
  ctx.globalAlpha = 1
}

/**
 * Chemin d index en va-et-vient sur `[0, count - 1]`, du type 0,1,2,…,N-1,N-2,…,0,1,…
 * Généralise l alternance avant/après d origine (N = 2 s y réduit exactement : la
 * suite vaut alors 0,1,0,1,…) à une série de N photos.
 */
export function bounceIndex(step: number, count: number): number {
  if (count <= 1) return 0
  const period = 2 * (count - 1)
  const p = step % period
  return p <= count - 1 ? p : period - p
}
