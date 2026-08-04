let persistenceRequest: Promise<boolean> | null = null

/**
 * Sort le stockage du cache éphémère, pour que le navigateur ne purge pas six mois
 * de chantier. Demandé une seule fois par session et jamais bloquant : un refus ne
 * doit pas empêcher d enregistrer une photo.
 */
export function ensurePersistence(): Promise<boolean> {
  persistenceRequest ??= (async () => {
    if (await isPersisted()) return true
    return requestPersistence()
  })()
  return persistenceRequest
}

/**
 * Demande explicite, **non mémoïsée** : c est le bouton des réglages.
 *
 * `ensurePersistence` ne peut pas servir ici. Elle est mémoïsée, et les deux chemins
 * d écriture l appellent bien avant que l utilisateur atteigne les réglages : elle
 * rendrait donc une promesse déjà résolue et n interrogerait jamais le navigateur une
 * seconde fois. Le bouton serait un no-op.
 */
export async function requestPersistence(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false
  try {
    const granted = await navigator.storage.persist()
    // Aligner le résultat mémoïsé sur la réalité, pour que le chemin d écriture ne
    // redemande pas inutilement après un accord obtenu ici.
    if (granted) persistenceRequest = Promise.resolve(true)
    return granted
  } catch {
    return false
  }
}

/** Réservé aux tests, qui rejouent la première demande. */
export function resetPersistenceForTests(): void {
  persistenceRequest = null
}

export async function isPersisted(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) return false
  try {
    return await navigator.storage.persisted()
  } catch {
    return false
  }
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null
  try {
    const estimate = await navigator.storage.estimate()
    return { usage: estimate.usage ?? 0, quota: estimate.quota ?? 0 }
  } catch {
    return null
  }
}

export function isQuotaError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')
  )
}

const UNITS = ['o', 'ko', 'Mo', 'Go'] as const

export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = Math.round(value * 10) / 10
  // Virgule décimale française, et pas de « ,0 » inutile.
  return `${String(rounded).replace('.', ',')} ${UNITS[unit]}`
}
