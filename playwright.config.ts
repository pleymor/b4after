import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  // Une reprise, comme filet contre une seule cause connue : enchaîner deux
  // exécutions sans laisser mourir les serveurs de la précédente. `reuseExistingServer`
  // fait alors s accrocher la nouvelle à un serveur agonisant, et un test au hasard
  // échoue sur net::ERR_CONNECTION_REFUSED avant même d atteindre l app.
  //
  // Mesuré : 4 reprises et 1 échec sur 8 exécutions enchaînées, contre 0 et 0 sur 5
  // exécutions séparées par l attente de libération des ports. La suite n est donc pas
  // instable en usage normal — une exécution à la fois.
  //
  // Playwright marque ces cas « flaky » et non « passed » : rien n est masqué, une
  // vraie instabilité de test resterait visible dans le rapport.
  retries: 1,
  projects: [
    {
      // Rendu et parcours : servis par le serveur de dev, qui transpile les
      // modules TS à la volée et permet de les importer depuis page.evaluate.
      name: 'dev',
      testIgnore: /offline\.spec\.ts/,
      use: {
        ...devices['Pixel 7'],
        baseURL: 'http://localhost:5173',
        launchOptions: {
          args: [
            '--use-fake-device-for-media-stream',
            '--use-fake-ui-for-media-stream',
          ],
        },
        permissions: ['camera'],
      },
    },
    {
      // Le service worker n existe qu après un vrai build.
      name: 'prod',
      testMatch: /offline\.spec\.ts/,
      use: { ...devices['Pixel 7'], baseURL: 'http://localhost:4173' },
    },
  ],
  webServer: [
    { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
    {
      command: 'npm run build && npm run preview -- --port 4173',
      url: 'http://localhost:4173',
      reuseExistingServer: true,
      timeout: 120_000,
    },
  ],
})
