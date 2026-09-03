import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Shot, Viewpoint } from '@/types'

export const DB_NAME = 'b4after'
export const DB_VERSION = 2

export interface B4Schema extends DBSchema {
  viewpoints: { key: string; value: Viewpoint }
  shots: {
    key: string
    value: Shot
    indexes: { 'by-viewpoint': [string, number]; 'by-order': [string, number] }
  }
}

/** Borne un index composite `[viewpointId, …]` à une seule série. */
export function seriesRange(viewpointId: string): IDBKeyRange {
  return IDBKeyRange.bound([viewpointId, -Infinity], [viewpointId, Infinity])
}

let connection: Promise<IDBPDatabase<B4Schema>> | null = null

export function openDb(): Promise<IDBPDatabase<B4Schema>> {
  connection ??= openDB<B4Schema>(DB_NAME, DB_VERSION, {
    async upgrade(db, oldVersion, _newVersion, tx) {
      if (oldVersion < 1) {
        db.createObjectStore('viewpoints', { keyPath: 'id' })
        const shots = db.createObjectStore('shots', { keyPath: 'id' })
        // L index composite permet de lister une série sans charger les blobs
        // des autres points de vue.
        shots.createIndex('by-viewpoint', ['viewpointId', 'takenAt'])
      }
      if (oldVersion < 2) {
        const shots = tx.objectStore('shots')
        shots.createIndex('by-order', ['viewpointId', 'order'])
        // Les bases de la version 1 n ont aucun rang : les laisser vides ferait
        // trier toute la série sur `undefined`, donc dans un ordre arbitraire.
        // On fige l ordre chronologique qui était le leur jusqu ici.
        const counters = new Map<string, number>()
        for (const shot of await shots.index('by-viewpoint').getAll()) {
          const rank = counters.get(shot.viewpointId) ?? 0
          counters.set(shot.viewpointId, rank + 1)
          await shots.put({ ...shot, order: rank })
        }
      }
    },
  })
  return connection
}

/**
 * Ferme et oublie la connexion mémoïsée. Réservé aux tests, qui recréent la base
 * entre chaque cas.
 *
 * La fermeture est indispensable : `indexedDB.deleteDatabase` n émet jamais
 * `success` tant qu une connexion reste ouverte — il émet `blocked` et la requête
 * attend. Oublier la promesse sans fermer la base ferait donc expirer chaque hook.
 */
export async function resetDbForTests(): Promise<void> {
  const pending = connection
  connection = null
  if (pending) (await pending).close()
}

export function newId(): string {
  return crypto.randomUUID()
}
