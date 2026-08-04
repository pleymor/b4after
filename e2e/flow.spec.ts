import { expect, test } from '@playwright/test'

/**
 * Vide IndexedDB avant chaque test pour partir d un état connu.
 *
 * On vide les magasins plutôt que d appeler `deleteDatabase`. Les deux marchent,
 * mais la suppression ne marche que par un enchaînement subtil : elle reste en
 * attente tant que l app tient une connexion, aboutit pendant le `reload` qui la
 * ferme, et la file d attente d IndexedDB garantit qu elle passe avant la
 * réouverture par la page rechargée. Vider les magasins ne dépend d aucun
 * ordonnancement et se lit sans détour.
 */
export async function resetDb(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.evaluate(async () => {
    const { openDb } = await import('/src/db/schema.ts')
    const db = await openDb()
    await db.clear('shots')
    await db.clear('viewpoints')
  })
  await page.reload()
}

/** Crée un point de vue et une photo directement en base, sans passer par la caméra. */
export async function seed(page: import('@playwright/test').Page, name: string) {
  return page.evaluate(async (viewpointName) => {
    const { createViewpoint } = await import('/src/db/viewpoints.ts')
    const { addShot } = await import('/src/db/shots.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const canvas = new OffscreenCanvas(300, 400)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, 300, 400)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg' })

    const viewpoint = await createViewpoint({
      name: viewpointName,
      frameWidth: 300,
      frameHeight: 400,
    })
    const shot = await addShot({
      viewpointId: viewpoint.id,
      blob,
      thumbBlob: blob,
      width: 300,
      height: 400,
      transform: IDENTITY,
    })
    return { viewpointId: viewpoint.id, shotId: shot.id }
  }, name)
}

test.beforeEach(async ({ page }) => {
  await resetDb(page)
})

test('affiche un état vide et l avertissement de premier lancement', async ({ page }) => {
  await expect(page.getByTestId('first-run-notice')).toBeVisible()
  await page.getByRole('button', { name: "J'ai compris" }).click()
  await expect(page.getByTestId('first-run-notice')).toBeHidden()

  await expect(page.getByTestId('empty-state')).toBeVisible()
  await expect(page.getByTestId('new-viewpoint')).toBeVisible()
})

test('liste les points de vue avec leurs agrégats', async ({ page }) => {
  await seed(page, 'Façade nord')
  await page.reload()
  // Écarter l avertissement avant d asserter : c est un overlay plein écran, donc
  // sans ça on vérifierait du contenu que l utilisateur ne peut ni voir ni toucher.
  await page.getByRole('button', { name: "J'ai compris" }).click()

  const item = page.getByTestId('viewpoint-item')
  await expect(item).toHaveCount(1)
  await expect(item).toBeVisible()
  await expect(item).toContainText('Façade nord')
  await expect(item).toContainText('1 photo')
})

test('crée un point de vue depuis la première photo', async ({ page }) => {
  await page.getByRole('button', { name: "J'ai compris" }).click()
  await page.getByTestId('new-viewpoint').click()

  // Relever les dimensions natives du flux avant de déclencher : c est à elles que
  // le cadre canonique devra être égal, et non à une résolution supposée.
  const shutter = page.getByTestId('shutter')
  await expect(shutter).toBeEnabled()
  await expect
    .poll(() => page.locator('video').evaluate((el: HTMLVideoElement) => el.videoWidth))
    .toBeGreaterThan(0)
  const native = await page
    .locator('video')
    .evaluate((el: HTMLVideoElement) => ({ width: el.videoWidth, height: el.videoHeight }))

  await shutter.click()

  const sheet = page.getByTestId('name-sheet')
  await expect(sheet).toBeVisible()
  await expect(page.getByTestId('name-input')).toHaveValue('Point de vue 1')

  await page.getByTestId('name-input').fill('Cuisine')
  await page.getByTestId('name-confirm').click()

  await expect(page.getByTestId('viewpoint-item')).toContainText('Cuisine')
  await expect(page.getByTestId('viewpoint-item')).toContainText('1 photo')

  // Le cadre canonique et la transformation identité portent toutes les tâches
  // suivantes, et aucun écran ne les affiche : on les vérifie donc en base.
  const stored = await page.evaluate(async () => {
    const { listViewpoints } = await import('/src/db/viewpoints.ts')
    const { listShots } = await import('/src/db/shots.ts')
    const [viewpoint] = await listViewpoints()
    const [shot] = await listShots(viewpoint.id)
    return {
      frame: { width: viewpoint.frameWidth, height: viewpoint.frameHeight },
      shot: { width: shot.width, height: shot.height },
      transform: shot.transform,
    }
  })

  // On compare aux dimensions natives relevées sur le flux, jamais à une résolution
  // codée en dur : la caméra synthétique de Chromium honore les contraintes
  // « idéales », donc sa sortie coïncide avec les valeurs demandées et une constante
  // ne discriminerait pas la régression qu on veut attraper — stocker les valeurs
  // demandées au lieu des dimensions réelles.
  expect(stored.frame).toEqual(native)
  expect(stored.shot).toEqual(native)
  expect(stored.transform).toEqual({ scale: 1, rotation: 0, tx: 0, ty: 0 })
})

test('le fantôme montre la dernière photo, pas la première', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord') // première photo, rouge
  // Deuxième photo, bleue : c est elle que le fantôme doit montrer.
  await page.evaluate(async (id) => {
    const { addShot } = await import('/src/db/shots.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')
    const canvas = new OffscreenCanvas(300, 400)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0000ff'
    ctx.fillRect(0, 0, 300, 400)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg' })
    await addShot({ viewpointId: id, blob, thumbBlob: blob, width: 300, height: 400, transform: IDENTITY })
  }, viewpointId)

  await page.goto(`/v/${viewpointId}/capture`)
  const ghost = page.getByTestId('ghost')
  await expect(ghost).toBeVisible()
  await expect(ghost).toHaveCSS('opacity', '0.5')

  // Échantillonner le centre du calque : bleu = dernière photo, rouge = première.
  // Sans cette assertion, remplacer shots.at(-1) par shots.at(0) passerait le test.
  await expect
    .poll(() =>
      ghost.evaluate((el: HTMLCanvasElement) => {
        const ctx = el.getContext('2d')!
        const { data } = ctx.getImageData(Math.floor(el.width / 2), Math.floor(el.height / 2), 1, 1)
        return data[2] > data[0] ? 'bleu' : 'rouge'
      }),
    )
    .toBe('bleu')

  await page.getByTestId('opacity-slider').fill('0.8')
  await expect(ghost).toHaveCSS('opacity', '0.8')
})

test("la reprise sur un identifiant inexistant n'écrit rien en base", async ({ page }) => {
  await page.goto('/v/identifiant-inexistant/capture')

  await expect(page.getByText("Ce point de vue n'existe plus.")).toBeVisible()

  // Le garde était `isRetake && id && frame` : un `frame` jamais résolu retombait dans
  // le flux « première photo », où confirmer le nom crée un point de vue parasite.
  const viewpointCount = await page.evaluate(async () => {
    const { listViewpoints } = await import('/src/db/viewpoints.ts')
    return (await listViewpoints()).length
  })
  expect(viewpointCount).toBe(0)
})

test('la reprise mène à l écran de calage sans rien écrire en base', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord')
  await page.goto(`/v/${viewpointId}/capture`)

  await page.getByTestId('shutter').click()
  await expect(page).toHaveURL(new RegExp(`/v/${viewpointId}/align$`))

  // La photo capturée ne doit pas encore être en base : elle ne rejoint la série
  // qu après validation du calage.
  const count = await page.evaluate(async (id) => {
    const { listShots } = await import('/src/db/shots.ts')
    return (await listShots(id)).length
  }, viewpointId)
  expect(count).toBe(1)
})

test('valide un calage et ajoute la photo à la série', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord')
  await page.goto(`/v/${viewpointId}/capture`)
  await page.getByTestId('shutter').click()

  const surface = page.getByTestId('align-surface')
  await expect(surface).toBeVisible()

  // Un glissement doit modifier la transformation, sans jamais sortir du cadre.
  const box = (await surface.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()

  await page.getByTestId('align-confirm').click()
  await expect(page).toHaveURL(new RegExp(`/v/${viewpointId}$`))

  const shots = await page.evaluate(async (id) => {
    const { listShots } = await import('/src/db/shots.ts')
    return (await listShots(id)).map((shot) => shot.transform)
  }, viewpointId)

  expect(shots).toHaveLength(2)
  expect(shots[1].tx).not.toBe(0)
})

test('remettre à zéro annule le calage en cours', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord')
  await page.goto(`/v/${viewpointId}/capture`)
  await page.getByTestId('shutter').click()

  const surface = page.getByTestId('align-surface')
  const box = (await surface.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()

  await page.getByTestId('align-reset').click()
  await page.getByTestId('align-confirm').click()
  // Attendre la navigation avant de lire la base : elle n a lieu qu après une
  // écriture réussie, et c est le seul point de synchronisation fiable. Sans elle
  // le test lit la série avant que la photo y soit, et ne passe que par chance.
  await expect(page).toHaveURL(new RegExp(`/v/${viewpointId}$`))

  const shots = await page.evaluate(async (id) => {
    const { listShots } = await import('/src/db/shots.ts')
    return (await listShots(id)).map((shot) => shot.transform)
  }, viewpointId)
  expect(shots[1].tx).toBe(0)
})

test('revenir à l écran de calage sans photo en attente renvoie à la série', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord')
  await page.goto(`/v/${viewpointId}/align`)
  await expect(page).toHaveURL(new RegExp(`/v/${viewpointId}$`))
})

test('présélectionne la plus ancienne et la plus récente', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord')
  // Deux photos de plus : avec trois clichés, « la plus ancienne et la plus récente »
  // se distingue de « les deux premières », ce qu un fixture à deux photos ne
  // permettait pas.
  await page.evaluate(async (id) => {
    const { addShot } = await import('/src/db/shots.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')
    const canvas = new OffscreenCanvas(300, 400)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0000ff'
    ctx.fillRect(0, 0, 300, 400)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg' })
    for (let i = 0; i < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 2))
      await addShot({ viewpointId: id, blob, thumbBlob: blob, width: 300, height: 400, transform: IDENTITY })
    }
  }, viewpointId)

  await page.goto(`/v/${viewpointId}`)
  await expect(page.getByTestId('shot-item')).toHaveCount(3)

  const items = page.getByTestId('shot-item')
  await expect(items.nth(0).getByTestId('select-before')).toBeChecked()
  await expect(items.nth(2).getByTestId('select-after')).toBeChecked()
  // La photo du milieu n est ni l avant ni l après.
  await expect(items.nth(1).getByTestId('select-before')).not.toBeChecked()
  await expect(items.nth(1).getByTestId('select-after')).not.toBeChecked()

  await page.getByTestId('compare').click()
  await expect(page).toHaveURL(/\/compare\?before=.+&after=.+/)
})

test('la sélection manuelle survit à la suppression d une autre photo', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord')
  // Deux photos de plus, pour disposer d une photo « du milieu » distincte de l avant
  // et de l après par défaut.
  await page.evaluate(async (id) => {
    const { addShot } = await import('/src/db/shots.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')
    const canvas = new OffscreenCanvas(300, 400)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0000ff'
    ctx.fillRect(0, 0, 300, 400)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg' })
    for (let i = 0; i < 2; i += 1) {
      await new Promise((r) => setTimeout(r, 2))
      await addShot({ viewpointId: id, blob, thumbBlob: blob, width: 300, height: 400, transform: IDENTITY })
    }
  }, viewpointId)

  await page.goto(`/v/${viewpointId}`)
  const items = page.getByTestId('shot-item')
  await expect(items).toHaveCount(3)

  // On choisit la photo du milieu comme « après », à la place de la plus récente
  // présélectionnée par défaut.
  await items.nth(1).getByTestId('select-after').check()
  await expect(items.nth(1).getByTestId('select-after')).toBeChecked()

  // On supprime une autre photo que celles sélectionnées : la plus récente.
  page.once('dialog', (dialog) => dialog.accept())
  await items.nth(2).getByTestId('delete-shot').click()
  await expect(items).toHaveCount(2)

  // La sélection — avant = la plus ancienne, après = celle du milieu — doit avoir
  // survécu : ce n est pas elle qui a disparu.
  await expect(items.nth(0).getByTestId('select-before')).toBeChecked()
  await expect(items.nth(1).getByTestId('select-after')).toBeChecked()
})

test('refuse de comparer une seule photo', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord')
  await page.goto(`/v/${viewpointId}`)
  await expect(page.getByTestId('compare')).toBeDisabled()
})

test('supprime une photo puis le point de vue', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord')
  await page.goto(`/v/${viewpointId}`)

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('delete-shot').first().click()
  await expect(page.getByTestId('shot-item')).toHaveCount(0)

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('delete-viewpoint').click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByTestId('empty-state')).toBeVisible()
})

test('supprimer la première photo ne change pas le cadre canonique', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord')
  await page.goto(`/v/${viewpointId}`)

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('delete-shot').first().click()
  await expect(page.getByTestId('shot-item')).toHaveCount(0)

  // Le cadre est porté par le point de vue, pas par ses photos : les calages déjà
  // enregistrés resteraient valides même après avoir vidé la série.
  const frame = await page.evaluate(async (id) => {
    const { getViewpoint } = await import('/src/db/viewpoints.ts')
    const found = await getViewpoint(id)
    return { width: found.frameWidth, height: found.frameHeight }
  }, viewpointId)
  expect(frame).toEqual({ width: 300, height: 400 })
})

test('renomme le point de vue', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord')
  await page.goto(`/v/${viewpointId}`)

  await page.getByTestId('rename').click()
  await page.getByTestId('name-input').fill('Cuisine')
  await page.getByTestId('name-confirm').click()

  await expect(page.getByRole('heading', { name: 'Cuisine' })).toBeVisible()
})

/** Ajoute une seconde photo bleue et renvoie l URL de comparaison. */
async function seedPair(page: import('@playwright/test').Page) {
  const { viewpointId } = await seed(page, 'Façade nord')
  const ids = await page.evaluate(async (id) => {
    const { addShot, listShots } = await import('/src/db/shots.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')
    const canvas = new OffscreenCanvas(300, 400)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0000ff'
    ctx.fillRect(0, 0, 300, 400)
    const blob = await canvas.convertToBlob({ type: 'image/jpeg' })
    await addShot({ viewpointId: id, blob, thumbBlob: blob, width: 300, height: 400, transform: IDENTITY })
    const shots = await listShots(id)
    return { before: shots[0].id, after: shots[1].id }
  }, viewpointId)
  return { viewpointId, ...ids }
}

test('exporte une image côte-à-côte', async ({ page }) => {
  const { viewpointId, before, after } = await seedPair(page)
  await page.goto(`/v/${viewpointId}/compare?before=${before}&after=${after}`)

  await expect(page.getByTestId('reveal-slider')).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByTestId('export-jpeg').click()
  const file = await download

  expect(file.suggestedFilename()).toMatch(/^b4after-facade-nord-\d{4}-\d{2}-\d{2}\.jpg$/)
})

test('exporte un GIF animé avec une progression', async ({ page }) => {
  const { viewpointId, before, after } = await seedPair(page)
  await page.goto(`/v/${viewpointId}/compare?before=${before}&after=${after}`)

  const download = page.waitForEvent('download')
  await page.getByTestId('export-gif').click()
  await expect(page.getByTestId('export-progress')).toBeVisible()
  const file = await download

  expect(file.suggestedFilename()).toMatch(/\.gif$/)
})

test('signale une comparaison introuvable', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord')
  await page.goto(`/v/${viewpointId}/compare?before=inconnu&after=inconnu`)
  await expect(page.getByTestId('export-status')).toContainText('introuvable')
})

test('affiche l état du stockage dans les réglages', async ({ page }) => {
  await page.getByRole('button', { name: "J'ai compris" }).click()
  await page.getByRole('link', { name: 'Réglages' }).click()

  await expect(page.getByTestId('storage-usage')).toContainText(/o|ko|Mo|Go/)
  await expect(page.getByTestId('persistence-state')).toBeVisible()
  await expect(page.getByTestId('app-version')).toBeVisible()
})
