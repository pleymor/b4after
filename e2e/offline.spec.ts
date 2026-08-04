import { expect, test } from '@playwright/test'

test('l app se charge hors ligne après une première visite', async ({ page, context }) => {
  await page.goto('/')
  // Laisser le service worker prendre le contrôle avant de couper le réseau.
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, {
    timeout: 15_000,
  })

  await context.setOffline(true)
  await page.reload()

  await expect(page.getByRole('heading', { name: 'b4after' })).toBeVisible()
  await expect(page.getByTestId('new-viewpoint')).toBeVisible()
})
