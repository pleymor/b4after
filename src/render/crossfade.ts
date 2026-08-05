import type { Transition } from '@/lib/exportOptions'
import type { Size, Transform } from '@/types'
import { drawShot, type Drawable } from './drawShot'
import { GIF_STEPS } from './gif'
import type { ComparisonInput } from './sideBySide'

/** Une entrée de comparaison ramenée à l échelle d export, sans sa date. */
export type ScaledInput = {
  source: Drawable
  transform: Transform
  shot: Size
}

/**
 * Ramène une entrée à l échelle d export. La transformation stockée est en pixels du
 * cadre canonique : sa translation suit le facteur, son `scale` est déjà relatif.
 */
export function scaleInput(input: ComparisonInput, factor: number): ScaledInput {
  return {
    source: input.source,
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

/**
 * Nombre de frames intermédiaires entre les deux paliers immobiles.
 *
 * Le fondu du GIF compte `GIF_STEPS` frames dont deux sont les paliers : il reste
 * `GIF_STEPS - 2` frames de transition. Une coupe franche n en a aucune.
 */
export function transitionSteps(transition: Transition): number {
  return transition === 'cut' ? 0 : GIF_STEPS - 2
}

/**
 * Dessine l état intermédiaire `mix` (0 = avant, 1 = après) selon la transition
 * demandée. Seul endroit du code où une transition est définie : `gif.ts` et
 * `video.ts` s en servent tous les deux, et se comportent donc pareil.
 */
export function drawTransition(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  from: ScaledInput,
  to: ScaledInput,
  size: Size,
  mix: number,
  transition: Transition,
): void {
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.globalAlpha = 1

  if (transition === 'cut') {
    // Aucun état intermédiaire à représenter : on bascule à mi-course.
    const shown = mix < 0.5 ? from : to
    drawShot(ctx, shown.source, shown.transform, size, shown.shot)
    return
  }

  drawShot(ctx, from.source, from.transform, size, from.shot)
  if (mix <= 0) return

  if (transition === 'wipe') {
    // Une ligne qui balaie l image, comme le curseur de révélation. Au retour, `mix`
    // redescend de 1 à 0 : le balayage repart de lui-même en sens inverse.
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, size.width * mix, size.height)
    ctx.clip()
    drawShot(ctx, to.source, to.transform, size, to.shot)
    ctx.restore()
    return
  }

  ctx.globalAlpha = mix
  drawShot(ctx, to.source, to.transform, size, to.shot)
  ctx.globalAlpha = 1
}
