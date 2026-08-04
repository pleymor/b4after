import type { Size } from '@/types'

/**
 * Convertit un point de la surface affichée en pixels du cadre canonique.
 *
 * Un ratio par axe : la surface de calage est un enfant flex compressible, donc son
 * rapport d aspect affiché ne vaut pas toujours celui du cadre. Réutiliser le ratio
 * horizontal pour l axe vertical fausserait les gestes verticaux.
 */
export function toFrameCoords(
  point: { x: number; y: number },
  rect: { left: number; top: number; width: number; height: number },
  frame: Size,
): { x: number; y: number } {
  if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 }
  return {
    x: (point.x - rect.left) * (frame.width / rect.width),
    y: (point.y - rect.top) * (frame.height / rect.height),
  }
}
