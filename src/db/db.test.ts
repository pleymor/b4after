import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { IDENTITY } from '@/align/transform'
import { DB_NAME, resetDbForTests } from './schema'
import {
  createViewpoint,
  deleteViewpoint,
  getViewpoint,
  listViewpoints,
  nextViewpointName,
  renameViewpoint,
} from './viewpoints'
import { addShot, deleteShot, getShot, listShots } from './shots'

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
    const recent = await seedShot(vp.id, 'recente')

    const [summary] = await listViewpoints()
    expect(summary.shotCount).toBe(2)
    expect(summary.lastShotAt).toBe(recent.takenAt)
    expect(await summary.coverThumb?.text()).toBe('t-recente')
  })

  it('renvoie un résumé vide pour un point de vue sans photo', async () => {
    await createViewpoint({ name: 'A', frameWidth: 1, frameHeight: 1 })
    const [summary] = await listViewpoints()
    expect(summary.shotCount).toBe(0)
    expect(summary.lastShotAt).toBeNull()
    expect(summary.coverThumb).toBeNull()
  })

  it('classe le cliché le plus récent en premier, les points de vue vides en dernier', async () => {
    const vide = await createViewpoint({ name: 'Vide', frameWidth: 1, frameHeight: 1 })
    const ancien = await createViewpoint({ name: 'Ancien', frameWidth: 1, frameHeight: 1 })
    const recent = await createViewpoint({ name: 'Récent', frameWidth: 1, frameHeight: 1 })
    await seedShot(ancien.id)
    await new Promise((r) => setTimeout(r, 2))
    await seedShot(recent.id)

    expect((await listViewpoints()).map((v) => v.name)).toEqual(['Récent', 'Ancien', 'Vide'])
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
