/**
 * Le flash de prise de vue, en magasin externe plutôt qu en état de composant.
 *
 * Le flux « reprise » navigue vers l écran de calage dès la tape : un flash rendu par
 * l écran caméra serait démonté avant d avoir été vu. Le magasin vit donc hors du
 * routeur, et `CaptureFlash` — monté une fois au-dessus des routes — survit à la
 * navigation.
 */
export const FLASH_MS = 220

const listeners = new Set<() => void>()
let flashing = false
let timer: ReturnType<typeof setTimeout> | null = null

export function subscribeFlash(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isFlashing(): boolean {
  return flashing
}

export function triggerFlash(): void {
  // Redéclencher pendant un flash en cours repart de zéro : deux prises rapprochées
  // doivent donner deux flashs pleins, pas un seul tronqué par le premier minuteur.
  if (timer) clearTimeout(timer)
  flashing = true
  notify()
  timer = setTimeout(() => {
    timer = null
    flashing = false
    notify()
  }, FLASH_MS)
}

function notify(): void {
  // Itérer le `Set` directement est sûr même si un abonné se désabonne au passage :
  // JavaScript saute les entrées supprimées avant d y arriver.
  for (const listener of listeners) listener()
}
