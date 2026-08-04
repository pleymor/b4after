import type { Shot, Transform } from '@/types'
import { newId, openDb } from './schema'
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
  const shot: Shot = { id: newId(), takenAt: Date.now(), ...input }
  const db = await openDb()
  await db.put('shots', shot)
  return shot
}

export async function listShots(viewpointId: string): Promise<Shot[]> {
  const db = await openDb()
  return db.getAllFromIndex(
    'shots',
    'by-viewpoint',
    IDBKeyRange.bound([viewpointId, -Infinity], [viewpointId, Infinity]),
  )
}

export async function getShot(id: string): Promise<Shot | undefined> {
  return (await openDb()).get('shots', id)
}

export async function deleteShot(id: string): Promise<void> {
  await (await openDb()).delete('shots', id)
}
