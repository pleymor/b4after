import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IDENTITY } from '@/align/transform'
import { DB_NAME, resetDbForTests } from './schema'
import { resetPersistenceForTests } from './storage'
import {
  createViewpoint,
  createViewpointWithFirstShot,
  deleteViewpoint,
  getViewpoint,
  listViewpoints,
  nextViewpointName,
  renameViewpoint,
} from './viewpoints'
import { addShot, deleteShot, getShot, listShots, reorderShots } from './shots'

function jpeg(marker: string): Blob {
  return new Blob([marker], { type: 'image/jpeg' })
}

async function seedShot(viewpointId: string, marker = 'x') {
  return addShot({
    viewpointId,
    blob: jpeg(marker),
    thumbBlob: jpeg(`t-${marker}`),
    width: 400,
    height: 600,
    transform: IDENTITY,
  })
}

beforeEach(async () => {
  // Fermer avant de supprimer : une base encore ouverte bloque la suppression.
  await resetDbForTests()
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
  })
})

describe('viewpoints', () => {
  it('crée un point de vue avec un id et une date', async () => {
    const vp = await createViewpoint({ name: 'Façade nord', frameWidth: 400, frameHeight: 600 })
    expect(vp.id).toMatch(/\S/)
    expect(typeof vp.createdAt).toBe('number')
    expect(await getViewpoint(vp.id)).toEqual(vp)
  })

  it('renomme', async () => {
    const vp = await createViewpoint({ name: 'A', frameWidth: 1, frameHeight: 1 })
    await renameViewpoint(vp.id, 'Cuisine')
    expect((await getViewpoint(vp.id))?.name).toBe('Cuisine')
  })

  it('propose un nom incrémenté', async () => {
    expect(await nextViewpointName()).toBe('Point de vue 1')
    await createViewpoint({ name: 'Point de vue 1', frameWidth: 1, frameHeight: 1 })
    expect(await nextViewpointName()).toBe('Point de vue 2')
  })

  it('supprime les photos en cascade', async () => {
    const vp = await createViewpoint({ name: 'A', frameWidth: 400, frameHeight: 600 })
    const shot = await seedShot(vp.id)
    await deleteViewpoint(vp.id)
    expect(await getViewpoint(vp.id)).toBeUndefined()
    expect(await getShot(shot.id)).toBeUndefined()
  })

  it('supprime toute la série en cascade, sans toucher aux autres points de vue', async () => {
    // Amorcer plusieurs photos est indispensable : avec une seule, une cascade
    // qui ne supprimerait que le premier résultat du curseur passerait le test.
    const cible = await createViewpoint({ name: 'Cible', frameWidth: 400, frameHeight: 600 })
    const premiere = await seedShot(cible.id, 'a')
    await new Promise((r) => setTimeout(r, 2))
    const deuxieme = await seedShot(cible.id, 'b')
    const troisieme = await seedShot(cible.id, 'c')

    const voisin = await createViewpoint({ name: 'Voisin', frameWidth: 400, frameHeight: 600 })
    const survivante = await seedShot(voisin.id, 'survivante')

    await deleteViewpoint(cible.id)

    expect(await listShots(cible.id)).toEqual([])
    expect(await getShot(premiere.id)).toBeUndefined()
    expect(await getShot(deuxieme.id)).toBeUndefined()
    expect(await getShot(troisieme.id)).toBeUndefined()
    // La borne de l index ne doit pas déborder sur le point de vue voisin.
    expect(await getShot(survivante.id)).toBeDefined()
  })

  it('agrège le nombre de photos, la dernière date et la vignette', async () => {
    const vp = await createViewpoint({ name: 'A', frameWidth: 400, frameHeight: 600 })
    await seedShot(vp.id, 'ancienne')
    // Sans ce délai les deux clichés peuvent partager la même milliseconde : la clé
    // composite [viewpointId, takenAt] est alors à égalité et IndexedDB départage
    // sur la clé primaire, un UUID aléatoire. La vignette choisie deviendrait
    // non déterministe.
    await new Promise((r) => setTimeout(r, 2))
    const recent = await seedShot(vp.id, 'recente')

    const [summary] = await listViewpoints()
    expect(summary.shotCount).toBe(2)
    expect(summary.lastShotAt).toBe(recent.takenAt)
    expect(await summary.coverThumb?.text()).toBe('t-recente')
  })

  it('prend pour vignette la dernière photo de l ordre manuel', async () => {
    const vp = await createViewpoint({ name: 'A', frameWidth: 400, frameHeight: 600 })
    const ancienne = await seedShot(vp.id, 'ancienne')
    await new Promise((r) => setTimeout(r, 2))
    const recente = await seedShot(vp.id, 'recente')

    await reorderShots(vp.id, [recente.id, ancienne.id])

    const [summary] = await listViewpoints()
    expect(await summary.coverThumb?.text()).toBe('t-ancienne')
    expect(summary.lastShotAt).toBe(ancienne.takenAt)
  })

  it('renvoie un résumé vide pour un point de vue sans photo', async () => {
    await createViewpoint({ name: 'A', frameWidth: 1, frameHeight: 1 })
    const [summary] = await listViewpoints()
    expect(summary.shotCount).toBe(0)
    expect(summary.lastShotAt).toBeNull()
    expect(summary.coverThumb).toBeNull()
  })

  it('classe le cliché le plus récent en premier, les points de vue vides en dernier', async () => {
    // Pas de liaison : seule l'existence de ce point de vue compte, et `tsc -b`
    // tourne avec noUnusedLocals — une variable non lue casserait le build.
    await createViewpoint({ name: 'Vide', frameWidth: 1, frameHeight: 1 })
    const ancien = await createViewpoint({ name: 'Ancien', frameWidth: 1, frameHeight: 1 })
    const recent = await createViewpoint({ name: 'Récent', frameWidth: 1, frameHeight: 1 })
    await seedShot(ancien.id)
    await new Promise((r) => setTimeout(r, 2))
    await seedShot(recent.id)

    expect((await listViewpoints()).map((v) => v.name)).toEqual(['Récent', 'Ancien', 'Vide'])
  })
})

describe('demande de persistance', () => {
  it('est demandée par la création avec première photo, et pas seulement par addShot', async () => {
    // Sans ce test, retirer ensurePersistence de createViewpointWithFirstShot
    // passerait inaperçu : la toute première photo de l app passe par là, jamais par
    // addShot, et l appel n a aucun effet observable ailleurs.
    const persist = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { storage: { persist, persisted: async () => false } })
    resetPersistenceForTests()

    await createViewpointWithFirstShot({
      name: 'Référence',
      width: 400,
      height: 600,
      blob: jpeg('pixels'),
      thumbBlob: jpeg('t'),
    })

    expect(persist).toHaveBeenCalled()
    vi.unstubAllGlobals()
    resetPersistenceForTests()
  })
})

describe('shots', () => {
  it('conserve le blob intact', async () => {
    const vp = await createViewpoint({ name: 'A', frameWidth: 400, frameHeight: 600 })
    const shot = await seedShot(vp.id, 'pixels')
    const stored = await getShot(shot.id)
    expect(await stored?.blob.text()).toBe('pixels')
    expect(stored?.transform).toEqual(IDENTITY)
  })

  it('liste par ordre chronologique croissant', async () => {
    const vp = await createViewpoint({ name: 'A', frameWidth: 400, frameHeight: 600 })
    const first = await seedShot(vp.id, 'a')
    await new Promise((r) => setTimeout(r, 2))
    const second = await seedShot(vp.id, 'b')
    expect((await listShots(vp.id)).map((s) => s.id)).toEqual([first.id, second.id])
  })

  it('numérote les rangs dans l ordre d ajout', async () => {
    const vp = await createViewpoint({ name: 'A', frameWidth: 400, frameHeight: 600 })
    const a = await seedShot(vp.id, 'a')
    const b = await seedShot(vp.id, 'b')
    const c = await seedShot(vp.id, 'c')
    expect([a.order, b.order, c.order]).toEqual([0, 1, 2])
  })

  it('repart de zéro pour chaque point de vue', async () => {
    // Un compteur global ferait passer un tri par rang : c est le rang *dans la
    // série* qui doit repartir à zéro, sinon le fantôme d un point de vue neuf
    // dépendrait des photos des autres.
    const a = await createViewpoint({ name: 'A', frameWidth: 1, frameHeight: 1 })
    const b = await createViewpoint({ name: 'B', frameWidth: 1, frameHeight: 1 })
    await seedShot(a.id)
    await seedShot(a.id)
    const premiere = await seedShot(b.id)
    expect(premiere.order).toBe(0)
  })

  it('liste dans l ordre manuel, pas dans l ordre chronologique', async () => {
    const vp = await createViewpoint({ name: 'A', frameWidth: 400, frameHeight: 600 })
    const a = await seedShot(vp.id, 'a')
    await new Promise((r) => setTimeout(r, 2))
    const b = await seedShot(vp.id, 'b')
    await new Promise((r) => setTimeout(r, 2))
    const c = await seedShot(vp.id, 'c')

    await reorderShots(vp.id, [c.id, a.id, b.id])

    expect((await listShots(vp.id)).map((s) => s.id)).toEqual([c.id, a.id, b.id])
  })

  it('ne touche pas aux dates en réordonnant', async () => {
    // `takenAt` reste la date de prise de vue : c est elle qui est affichée dans la
    // liste et qui nomme les fichiers exportés.
    const vp = await createViewpoint({ name: 'A', frameWidth: 1, frameHeight: 1 })
    const a = await seedShot(vp.id, 'a')
    await new Promise((r) => setTimeout(r, 2))
    const b = await seedShot(vp.id, 'b')

    await reorderShots(vp.id, [b.id, a.id])

    expect((await getShot(a.id))?.takenAt).toBe(a.takenAt)
    expect((await getShot(b.id))?.takenAt).toBe(b.takenAt)
  })

  it('ignore un identifiant étranger à la série', async () => {
    // Sans ce garde-fou, un rang venu d un autre point de vue écraserait celui de sa
    // propre série et brouillerait son ordre à distance.
    const cible = await createViewpoint({ name: 'Cible', frameWidth: 1, frameHeight: 1 })
    const voisin = await createViewpoint({ name: 'Voisin', frameWidth: 1, frameHeight: 1 })
    const a = await seedShot(cible.id, 'a')
    const b = await seedShot(cible.id, 'b')
    const etrangere = await seedShot(voisin.id, 'etrangere')

    await reorderShots(cible.id, [b.id, etrangere.id, a.id])

    expect((await listShots(cible.id)).map((s) => s.id)).toEqual([b.id, a.id])
    expect((await getShot(etrangere.id))?.order).toBe(etrangere.order)
  })

  it('place la nouvelle photo en fin de série même après un réordonnancement', async () => {
    // Le fantôme de la prise suivante est `listShots().at(-1)` : une photo qui
    // n atterrirait pas en dernier ferait caler la reprise sur la mauvaise image.
    const vp = await createViewpoint({ name: 'A', frameWidth: 1, frameHeight: 1 })
    const a = await seedShot(vp.id, 'a')
    const b = await seedShot(vp.id, 'b')
    await reorderShots(vp.id, [b.id, a.id])
    const c = await seedShot(vp.id, 'c')
    expect((await listShots(vp.id)).map((s) => s.id)).toEqual([b.id, a.id, c.id])
  })

  it('n expose pas les photos des autres points de vue', async () => {
    const a = await createViewpoint({ name: 'A', frameWidth: 1, frameHeight: 1 })
    const b = await createViewpoint({ name: 'B', frameWidth: 1, frameHeight: 1 })
    await seedShot(a.id)
    await seedShot(b.id)
    expect(await listShots(a.id)).toHaveLength(1)
  })

  it('supprime une photo sans toucher au point de vue', async () => {
    const vp = await createViewpoint({ name: 'A', frameWidth: 400, frameHeight: 600 })
    const shot = await seedShot(vp.id)
    await deleteShot(shot.id)
    expect(await getShot(shot.id)).toBeUndefined()
    expect(await getViewpoint(vp.id)).toBeDefined()
  })
})

describe('migration du schéma', () => {
  /** Recrée la base telle que la version 1 la laissait : aucun rang, aucun index d ordre. */
  function openVersion1(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1)
      request.onupgradeneeded = () => {
        const db = request.result
        db.createObjectStore('viewpoints', { keyPath: 'id' })
        const shots = db.createObjectStore('shots', { keyPath: 'id' })
        shots.createIndex('by-viewpoint', ['viewpointId', 'takenAt'])
      }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
  }

  function put(db: IDBDatabase, store: string, value: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite')
      tx.objectStore(store).put(value)
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
  }

  it('numérote les séries existantes par ordre chronologique', async () => {
    // Les bases déjà installées n ont pas de rang : sans reprise, `listShots` les
    // trierait toutes sur `undefined` et l ordre affiché deviendrait arbitraire.
    const legacy = await openVersion1()
    await put(legacy, 'viewpoints', {
      id: 'vp-1',
      name: 'Ancienne base',
      createdAt: 1,
      frameWidth: 400,
      frameHeight: 600,
    })
    const shot = (id: string, takenAt: number) => ({
      id,
      viewpointId: 'vp-1',
      takenAt,
      blob: jpeg(id),
      thumbBlob: jpeg(`t-${id}`),
      width: 400,
      height: 600,
      transform: IDENTITY,
    })
    await put(legacy, 'shots', shot('s-c', 300))
    await put(legacy, 'shots', shot('s-a', 100))
    await put(legacy, 'shots', shot('s-b', 200))
    // Une seconde série : la numérotation repart de zéro pour chacune.
    await put(legacy, 'viewpoints', {
      id: 'vp-2',
      name: 'Voisine',
      createdAt: 2,
      frameWidth: 400,
      frameHeight: 600,
    })
    await put(legacy, 'shots', { ...shot('s-d', 50), viewpointId: 'vp-2' })
    legacy.close()

    expect((await listShots('vp-1')).map((s) => [s.id, s.order])).toEqual([
      ['s-a', 0],
      ['s-b', 1],
      ['s-c', 2],
    ])
    expect((await listShots('vp-2')).map((s) => s.order)).toEqual([0])
  })
})
