import { IDENTITY } from '@/align/transform'
import type { Shot, Viewpoint, ViewpointSummary } from '@/types'
import { newId, openDb } from './schema'

export async function createViewpoint(input: {
  name: string
  frameWidth: number
  frameHeight: number
}): Promise<Viewpoint> {
  const viewpoint: Viewpoint = { id: newId(), createdAt: Date.now(), ...input }
  const db = await openDb()
  await db.put('viewpoints', viewpoint)
  return viewpoint
}

export async function getViewpoint(id: string): Promise<Viewpoint | undefined> {
  return (await openDb()).get('viewpoints', id)
}

export async function renameViewpoint(id: string, name: string): Promise<void> {
  const db = await openDb()
  const existing = await db.get('viewpoints', id)
  if (!existing) return
  await db.put('viewpoints', { ...existing, name })
}

export async function deleteViewpoint(id: string): Promise<void> {
  const db = await openDb()
  const tx = db.transaction(['viewpoints', 'shots'], 'readwrite')
  const index = tx.objectStore('shots').index('by-viewpoint')
  for await (const cursor of index.iterate(
    IDBKeyRange.bound([id, -Infinity], [id, Infinity]),
  )) {
    await cursor.delete()
  }
  await tx.objectStore('viewpoints').delete(id)
  await tx.done
}

/**
 * Points de vue enrichis de leurs agrégats, le cliché le plus récent en premier.
 * L écran d accueil n a ainsi aucune agrégation à faire.
 */
export async function listViewpoints(): Promise<ViewpointSummary[]> {
  const db = await openDb()
  const viewpoints = await db.getAll('viewpoints')
  const index = db.transaction('shots').store.index('by-viewpoint')

  const summaries = await Promise.all(
    viewpoints.map(async (viewpoint) => {
      const range = IDBKeyRange.bound(
        [viewpoint.id, -Infinity],
        [viewpoint.id, Infinity],
      )
      const shotCount = await index.count(range)
      // `prev` donne directement le cliché le plus récent de la série.
      const latest = await index.openCursor(range, 'prev')
      return {
        ...viewpoint,
        shotCount,
        lastShotAt: latest?.value.takenAt ?? null,
        coverThumb: latest?.value.thumbBlob ?? null,
      }
    }),
  )

  return summaries.sort((a, b) => (b.lastShotAt ?? -1) - (a.lastShotAt ?? -1))
}

export async function nextViewpointName(): Promise<string> {
  const count = await (await openDb()).count('viewpoints')
  return `Point de vue ${count + 1}`
}

/**
 * Crée un point de vue et sa photo de référence dans une seule transaction : les deux
 * ou rien. Deux écritures séparées laisseraient un point de vue orphelin sans photo
 * dans la liste d accueil si la seconde échouait — précisément le cas du stockage
 * plein, et chaque nouvelle tentative en créerait un de plus.
 *
 * La photo de référence *définit* le cadre canonique : ses dimensions deviennent
 * celles du cadre et sa transformation est l identité par construction. L invariant
 * est donc porté ici, pas laissé à la charge de l appelant.
 */
export async function createViewpointWithFirstShot(input: {
  name: string
  width: number
  height: number
  blob: Blob
  thumbBlob: Blob
}): Promise<{ viewpoint: Viewpoint; shot: Shot }> {
  const now = Date.now()
  const viewpoint: Viewpoint = {
    id: newId(),
    createdAt: now,
    name: input.name,
    frameWidth: input.width,
    frameHeight: input.height,
  }
  const shot: Shot = {
    id: newId(),
    viewpointId: viewpoint.id,
    takenAt: now,
    blob: input.blob,
    thumbBlob: input.thumbBlob,
    width: input.width,
    height: input.height,
    transform: IDENTITY,
  }

  const db = await openDb()
  const tx = db.transaction(['viewpoints', 'shots'], 'readwrite')
  await Promise.all([
    tx.objectStore('viewpoints').put(viewpoint),
    tx.objectStore('shots').put(shot),
    tx.done,
  ])
  return { viewpoint, shot }
}
