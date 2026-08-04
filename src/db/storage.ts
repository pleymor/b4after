let persistenceRequest: Promise<boolean> | null = null

/**
 * Sort le stockage du cache éphémère, pour que le navigateur ne purge pas six mois
 * de chantier. Demandé une seule fois par session et jamais bloquant : un refus ne
 * doit pas empêcher d enregistrer une photo.
 */
export function ensurePersistence(): Promise<boolean> {
  persistenceRequest ??= (async () => {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist || !navigator.storage?.persisted)
      return false
    try {
      if (await navigator.storage.persisted()) return true
      return await navigator.storage.persist()
    } catch {
      return false
    }
  })()
  return persistenceRequest
}

/** Réservé aux tests, qui rejouent la première demande. */
export function resetPersistenceForTests(): void {
  persistenceRequest = null
}

export async function isPersisted(): Promise<boolean> {
  if (!navigator.storage?.persisted) return false
  try {
    return await navigator.storage.persisted()
  } catch {
    return false
  }
}

export async function getStorageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null
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
