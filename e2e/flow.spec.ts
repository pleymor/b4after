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

  const item = page.getByTestId('viewpoint-item')
  await expect(item).toHaveCount(1)
  await expect(item).toContainText('Façade nord')
  await expect(item).toContainText('1 photo')
})
