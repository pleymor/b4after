import type { Size } from '@/types'

function isPortrait(size: Size): boolean {
  return size.height > size.width
}

/**
 * Vrai quand l écran et le cadre canonique n ont pas la même orientation : reprendre
 * la photo téléphone tourné donnerait un cadrage inutilisable. Un cadre carré ne
 * contraint rien.
 */
export function needsRotationHint(viewport: Size, frame: Size): boolean {
  if (frame.width === frame.height) return false
  return isPortrait(viewport) !== isPortrait(frame)
}
