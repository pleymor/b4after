import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { favicon } from './build/favicon.ts'

/**
 * Révision git courte, ou `'dev'` quand le build ne part pas d un dépôt — une archive
 * téléchargée doit pouvoir se construire. `stdio` en `pipe` pour que l échec de la
 * commande ne salisse pas la sortie du build.
 */
function shortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}


/**
 * Le fond du logo, échantillonné dans `public/logo.png`. Sert à combler le
 * rembourrage des icônes masquables : toute autre teinte dessinerait une bordure
 * visible autour de la marque. Volontairement distinct du `theme_color`, qui
 * habille le navigateur et suit la palette de l app, pas celle de l icône.
 *
 * `build/favicon.ts` en garde une copie, pour la même raison.
 */
const ICON_BG = '#161a22'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Avant VitePWA, dont le préréglage ci-dessous laisse volontairement la
    // favicon à ce plugin : le logo entier est illisible à 16 px.
    favicon(),
    VitePWA({
      // `prompt` et non `autoUpdate` : le nouveau service worker attend au lieu de
      // s imposer. C est l app qui propose le rechargement, et l utilisateur qui
      // choisit son moment — un rechargement subi en plein calage perdrait la photo
      // en attente, qui ne vit qu en mémoire.
      registerType: 'prompt',
      // L enregistrement est fait par `useRegisterSW` dans UpdateNotice, pas par un
      // script injecté : sinon le service worker serait enregistré deux fois.
      injectRegister: null,
      // `public/logo.png` est la source unique de toutes les icônes, générées au
      // build. Elle doit vivre dans `public/` : ailleurs, le plugin ne produit
      // silencieusement aucune icône alors que le manifeste continue de les
      // annoncer. Le préréglage est décrit en entier plutôt que repris de
      // `minimal-2023`, dont les valeurs par défaut supposent un logo entouré de
      // marge — le nôtre est plein cadre.
      pwaAssets: {
        image: 'public/logo.png',
        preset: {
          // Aucun rembourrage : la marque occupe tout le carré et c est le
          // système qui applique SON arrondi. Rembourrer ici ajouterait un liseré
          // autour de l icône, et arrondir en amont donnerait un double arrondi.
          //
          // Le `favicons` du préréglage est laissé vide : à 16 px le logo entier
          // ne dit plus rien, et `build/favicon.ts` en recadre la signature. Un
          // seul producteur de `favicon.ico`, sinon tous deux se disputeraient le
          // même nom de fichier.
          transparent: {
            sizes: [64, 192, 512],
            padding: 0,
            resizeOptions: { fit: 'contain', background: ICON_BG },
          },
          // Android rogne les icônes masquables jusqu au cercle inscrit à 80 % du
          // côté. Sans retrait, la pointe du « 4 » passerait dehors : on réduit
          // la marque à 80 % et on comble avec son propre fond.
          maskable: {
            sizes: [512],
            padding: 0.1,
            resizeOptions: { fit: 'contain', background: ICON_BG },
          },
          // iOS arrondit les coins mais ne rogne pas : plein cadre, comme les
          // icônes classiques.
          apple: {
            sizes: [180],
            padding: 0,
            resizeOptions: { fit: 'contain', background: ICON_BG },
          },
        },
      },
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
        // `ico` pour la favicon : l ancienne icône SVG était précachée par le
        // motif `svg`, le format a changé, le hors ligne doit suivre.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,ico}'],
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
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    // Évaluée au chargement de la config, donc à chaque build. C est ce qui rend la
    // date honnête — et, accessoirement, ce qui fait changer l empreinte du bundle à
    // chaque déploiement, donc retélécharger les clients. Le dépôt déployant déjà à
    // chaque push, l effet est le même qu avant.
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __COMMIT_SHA__: JSON.stringify(shortSha()),
  },
  test: { environment: 'node', globals: true, include: ['src/**/*.test.ts'] },
})
