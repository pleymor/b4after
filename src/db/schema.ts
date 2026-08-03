import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Shot, Viewpoint } from '@/types'

export const DB_NAME = 'b4after'
export const DB_VERSION = 1

export interface B4Schema extends DBSchema {
  viewpoints: { key: string; value: Viewpoint }
  shots: {
    key: string
    value: Shot
    indexes: { 'by-viewpoint': [string, number] }
  }
}

let connection: Promise<IDBPDatabase<B4Schema>> | null = null

export function openDb(): Promise<IDBPDatabase<B4Schema>> {
  connection ??= openDB<B4Schema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('viewpoints', { keyPath: 'id' })
      const shots = db.createObjectStore('shots', { keyPath: 'id' })
      // L index composite permet de lister une série triée sans charger les blobs
      // des autres points de vue.
      shots.createIndex('by-viewpoint', ['viewpointId', 'takenAt'])
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
