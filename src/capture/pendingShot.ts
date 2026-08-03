import type { CapturedFrame } from '@/camera/useCamera'
import type { Size } from '@/types'

export type PendingShot = {
  viewpointId: string
  frame: Size
  captured: CapturedFrame
}

/**
 * Passe la photo capturée de l écran caméra à l écran de calage sans l écrire en base :
 * une photo non validée ne doit jamais atterrir dans la série. Volontairement en
 * mémoire — un rechargement de page annule le calage en cours, ce qui est le
 * comportement attendu.
 */
let pending: PendingShot | null = null

export function setPendingShot(shot: PendingShot): void {
  pending = shot
}

export function peekPendingShot(): PendingShot | null {
  return pending
}

export function takePendingShot(): PendingShot | null {
  const shot = pending
  pending = null
  return shot
}
