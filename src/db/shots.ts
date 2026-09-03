import type { Shot, Transform } from '@/types'
import { newId, openDb, seriesRange } from './schema'
import { ensurePersistence } from './storage'

export async function addShot(input: {
  viewpointId: string
  blob: Blob
  thumbBlob: Blob
  width: number
  height: number
  transform: Transform
}): Promise<Shot> {
  // Au premier enregistrement seulement : l appel est mémoïsé et n échoue jamais.
  await ensurePersistence()
  const db = await openDb()
  const tx = db.transaction('shots', 'readwrite')
  // Lecture du dernier rang et écriture dans la même transaction : deux captures
  // concurrentes ne peuvent pas se voir attribuer le même.
  const last = await tx.store.index('by-order').openCursor(seriesRange(input.viewpointId), 'prev')
  const shot: Shot = {
    id: newId(),
    takenAt: Date.now(),
    // Une nouvelle photo se pose toujours en fin de série, quel que soit l ordre
    // manuel : c est elle que la reprise suivante prendra pour fantôme.
    order: (last?.value.order ?? -1) + 1,
    ...input,
  }
  await tx.store.put(shot)
  await tx.done
  return shot
}

/** La série dans son ordre manuel, du premier au dernier rang. */
export async function listShots(viewpointId: string): Promise<Shot[]> {
  const db = await openDb()
  return db.getAllFromIndex('shots', 'by-order', seriesRange(viewpointId))
}

/**
 * Renumérote la série entière d un coup : `orderedIds` donne l ordre voulu, chaque
 * photo reçoit son index pour rang.
 *
 * Une seule transaction pour toute la série, car un ordre à moitié écrit serait pire
 * que l ancien — deux photos partageraient un rang et IndexedDB les départagerait
 * sur un UUID aléatoire.
 */
export async function reorderShots(viewpointId: string, orderedIds: string[]): Promise<void> {
  const db = await openDb()
  const tx = db.transaction('shots', 'readwrite')
  let rank = 0
  for (const id of orderedIds) {
    const shot = await tx.store.get(id)
    // Une photo supprimée entre-temps, ou appartenant à une autre série, ne doit ni
    // ressusciter ni se voir renumérotée à distance.
    if (!shot || shot.viewpointId !== viewpointId) continue
    await tx.store.put({ ...shot, order: rank })
    rank += 1
  }
  await tx.done
}

export async function getShot(id: string): Promise<Shot | undefined> {
  return (await openDb()).get('shots', id)
}

export async function deleteShot(id: string): Promise<void> {
  await (await openDb()).delete('shots', id)
}
