import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
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
