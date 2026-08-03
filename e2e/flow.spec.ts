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

test('affiche le fantôme de la dernière photo à la reprise', async ({ page }) => {
  const { viewpointId } = await seed(page, 'Façade nord')
  await page.goto(`/v/${viewpointId}/capture`)

  const ghost = page.getByTestId('ghost')
  await expect(ghost).toBeVisible()
  await expect(ghost).toHaveCSS('opacity', '0.5')

  await page.getByTestId('opacity-slider').fill('0.8')
  await expect(ghost).toHaveCSS('opacity', '0.8')
})
