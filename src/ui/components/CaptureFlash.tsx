import { useSyncExternalStore } from 'react'
import { FLASH_MS, isFlashing, subscribeFlash } from '@/capture/flash'

/**
 * Le retour visuel de la tape sur le déclencheur : un voile blanc qui s allume d un coup
 * et s efface.
 *
 * Monté au-dessus des routes, jamais dans un écran : le flux « reprise » navigue vers le
 * calage dès la tape, et un flash rendu par l écran caméra serait démonté avant d avoir
 * été vu.
 */
export function CaptureFlash() {
  const flashing = useSyncExternalStore(subscribeFlash, isFlashing, () => false)

  return (
    <div
      data-testid="capture-flash"
      data-active={flashing}
      aria-hidden="true"
      className={`pointer-events-none fixed inset-0 z-50 bg-white ${
        flashing ? 'capture-flash' : 'opacity-0'
      }`}
      // La durée vient du magasin : le voile doit avoir fini son fondu quand celui-ci
      // repasse à l état éteint, sinon l animation est coupée net.
      style={{ animationDuration: `${FLASH_MS}ms` }}
    />
  )
}
