import type { Size, Transform } from '@/types'

export const IDENTITY: Transform = { scale: 1, rotation: 0, tx: 0, ty: 0 }

/** 15°, la limite de rotation offerte au calage. */
export const MAX_ROTATION = Math.PI / 12

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/**
 * Boîte englobante du cadre canonique, exprimée dans le repère tourné de la photo.
 * C est cette boîte que la photo doit couvrir.
 */
export function rotatedFrameBounds(frame: Size, rotation: number): Size {
  const cos = Math.abs(Math.cos(rotation))
  const sin = Math.abs(Math.sin(rotation))
  return {
    width: frame.width * cos + frame.height * sin,
    height: frame.width * sin + frame.height * cos,
  }
}

/** Échelle minimale pour que la photo couvre entièrement le cadre à cette rotation. */
export function scaleMin(frame: Size, shot: Size, rotation: number): number {
  const bounds = rotatedFrameBounds(frame, rotation)
  return Math.max(bounds.width / shot.width, bounds.height / shot.height)
}

/**
 * Ramène une transformation dans le domaine valide : rotation bornée, échelle au moins
 * suffisante pour couvrir le cadre, translation limitée au jeu restant.
 *
 * La borne de translation s appuie sur la boîte englobante, elle est donc légèrement
 * conservatrice à forte rotation. Compromis assumé : à ±15° l écart est négligeable et
 * la formule exacte complique le code sans bénéfice.
 */
export function clampToCover(transform: Transform, shot: Size, frame: Size): Transform {
  const rotation = clamp(transform.rotation, -MAX_ROTATION, MAX_ROTATION)
  const scale = Math.max(transform.scale, scaleMin(frame, shot, rotation))
  const bounds = rotatedFrameBounds(frame, rotation)

  const slackX = Math.max(0, (scale * shot.width - bounds.width) / 2)
  const slackY = Math.max(0, (scale * shot.height - bounds.height) / 2)

  // La translation est stockée dans le repère écran, mais le jeu se mesure dans le
  // repère de la photo : on y passe, on clampe, on revient.
  const inCos = Math.cos(-rotation)
  const inSin = Math.sin(-rotation)
  const px = clamp(transform.tx * inCos - transform.ty * inSin, -slackX, slackX)
  const py = clamp(transform.tx * inSin + transform.ty * inCos, -slackY, slackY)

  const outCos = Math.cos(rotation)
  const outSin = Math.sin(rotation)
  return {
    scale,
    rotation,
    tx: px * outCos - py * outSin,
    ty: px * outSin + py * outCos,
  }
}

/**
 * Matrice à passer à `ctx.setTransform` pour dessiner la photo en (0, 0, w, h).
 * Composition : translate(centre du cadre + t) · rotate · scale · translate(-w/2, -h/2).
 */
export function toMatrix(
  transform: Transform,
  frame: Size,
  shot: Size,
): { a: number; b: number; c: number; d: number; e: number; f: number } {
  const { scale, rotation, tx, ty } = transform
  const cos = Math.cos(rotation)
  const sin = Math.sin(rotation)

  const a = scale * cos
  const b = scale * sin
  const c = -scale * sin
  const d = scale * cos

  return {
    a,
    b,
    c,
    d,
    e: frame.width / 2 + tx + a * (-shot.width / 2) + c * (-shot.height / 2),
    f: frame.height / 2 + ty + b * (-shot.width / 2) + d * (-shot.height / 2),
  }
}
