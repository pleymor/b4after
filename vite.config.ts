import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Hash du commit et date du build : en CI, GITHUB_SHA ; en local, git. */
function buildStamp(): string {
  const sha =
    process.env.GITHUB_SHA?.slice(0, 7) ??
    (() => {
      try {
        return execSync('git rev-parse --short HEAD').toString().trim()
      } catch {
        return 'inconnu'
      }
    })()
  return `${sha} · ${new Date().toISOString().slice(0, 10)}`
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // `prompt` et non `autoUpdate` : le nouveau service worker attend au lieu de
      // s imposer. C est l app qui propose le rechargement, et l utilisateur qui
      // choisit son moment — un rechargement subi en plein calage perdrait la photo
      // en attente, qui ne vit qu en mémoire.
      registerType: 'prompt',
      // L enregistrement est fait par `useRegisterSW` dans UpdateNotice, pas par un
      // script injecté : sinon le service worker serait enregistré deux fois.
      injectRegister: null,
      pwaAssets: { image: 'public/icon.svg' },
      manifest: {
        name: 'b4after — comparaisons avant/après',
        short_name: 'b4after',
        description: 'Reprenez une photo sous le même angle et générez des comparaisons avant/après.',
        lang: 'fr',
        start_url: '/',
        display: 'standalone',
        background_color: '#0f172a',
        theme_color: '#0f172a',
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Les deux réglages sont indépendants et on veut le meilleur de chacun.
        // `clientsClaim` fait prendre le contrôle dès la PREMIÈRE visite, sans quoi
        // le hors ligne ne marcherait qu au deuxième chargement. `skipWaiting` à faux
        // fait ATTENDRE les versions suivantes : c est le bandeau qui les active, sur
        // décision de l utilisateur.
        clientsClaim: true,
        skipWaiting: false,
      },
      devOptions: { enabled: false },
    }),
  ],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // Identifie précisément le build servi. `npm_package_version` ne servait à rien :
  // package.json est figé à 0.0.0, donc l écran de réglages affichait toujours la
  // même chose et ne permettait pas de savoir quelle version tournait réellement.
  define: { __APP_VERSION__: JSON.stringify(buildStamp()) },
  test: { environment: 'node', globals: true, include: ['src/**/*.test.ts'] },
})
