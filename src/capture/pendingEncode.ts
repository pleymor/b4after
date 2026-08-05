/**
 * Un travail démarré tôt et attendu tard.
 *
 * L encodage JPEG d une prise coûte plusieurs secondes sur mobile, mais son résultat
 * n est nécessaire qu au moment d écrire en base — bien après que l utilisateur ait vu
 * sa photo. On le lance donc dès la saisie et on ne l attend qu à l enregistrement.
 */
export type PendingEncode<T> = {
  /** Vrai dès que le résultat est disponible : l attente sera instantanée. */
  isDone: () => boolean
  result: () => Promise<T>
}

export function startEncoding<T>(encode: () => Promise<T>): PendingEncode<T> {
  let promise: Promise<T> | null = null
  let done = false

  function run(): Promise<T> {
    const started = encode().then(
      (value) => {
        done = true
        return value
      },
      (error) => {
        // Oublier la promesse rejetée : sinon un échec transitoire condamnerait la
        // photo, « Enregistrer » retombant éternellement sur le même rejet. Le
        // prochain `result()` relance un encodage neuf.
        if (promise === started) promise = null
        throw error
      },
    )
    // Marquer le rejet comme géré dès maintenant : entre la saisie et
    // l enregistrement, personne n attend encore ce résultat, et un échec ne doit pas
    // remonter en `unhandledrejection`.
    started.catch(() => undefined)
    promise = started
    return started
  }

  run()

  return {
    isDone: () => done,
    result: () => promise ?? run(),
  }
}
