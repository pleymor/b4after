import { resolve } from 'node:path'
import sharp from 'sharp'
import { encode } from 'sharp-ico'
import type { Plugin } from 'vite'

/**
 * Fabrique `favicon.ico` à partir de `public/logo.png`.
 *
 * Le logo complet ne survit pas à 16 px : « AFTER » s y réduit à une tache et la
 * hampe du curseur mange la moitié de la hauteur, ce qui rapetisse le B|4 au
 * point de le rendre illisible. On ne redimensionne donc pas le logo, on en
 * recadre la signature — B, trait de comparaison, poignée, 4 — et on la recentre
 * sur le fond de la marque. Même fond, mêmes glyphes, mêmes couleurs que l icône
 * d application : la favicon en est la version réduite, pas un dessin différent.
 *
 * `vite-plugin-pwa` ne sait générer les icônes que depuis une seule image (il
 * refuse explicitement un tableau), et il tirerait la favicon du logo entier.
 * D où ce plugin, avec le `favicons` du préréglage laissé vide dans
 * `vite.config.ts` pour qu il n y ait qu un seul producteur de `favicon.ico`.
 */

const SOURCE = 'public/logo.png'

/**
 * Garde-fou : `MARK` est mesuré à la main sur le logo actuel. Si celui-ci change
 * de dimensions, le cadrage ne veut plus rien dire — mieux vaut casser le build
 * que livrer une favicon rognée n importe où.
 */
const SOURCE_SIZE = 1024

/**
 * La signature dans `public/logo.png`, mot « AFTER » exclu et hampe rognée juste
 * au-dessus des glyphes. Plus large que haute : elle ne peut pas être un carré
 * découpé dans la source sans mordre sur « AFTER », d où le recentrage.
 */
const MARK = { left: 141, top: 217, width: 763, height: 572 }

/** Le fond du logo, identique à `ICON_BG` dans `vite.config.ts`. */
const BG = '#161a22'

/** Les navigateurs ne rognent pas les favicons : on remplit presque tout. */
const FILL = 0.92

/**
 * 16 et 32 px couvrent les onglets, 48 px la barre de favoris et les raccourcis
 * Windows. Chaque taille est rééchantillonnée depuis la source plutôt que laissée
 * au navigateur, qui étirerait un seul bitmap.
 */
const SIZES = [16, 32, 48]

async function renderIco(root: string): Promise<Buffer> {
  const source = resolve(root, SOURCE)
  const { width, height } = await sharp(source).metadata()
  if (width !== SOURCE_SIZE || height !== SOURCE_SIZE) {
    throw new Error(
      `${SOURCE} fait ${width}x${height} au lieu de ${SOURCE_SIZE}² : le cadrage `
      + 'MARK de build/favicon.ts a été mesuré sur une autre image, il faut le reprendre.',
    )
  }

  const frames = await Promise.all(SIZES.map(async (px) => {
    const w = Math.round(px * FILL)
    const h = Math.max(1, Math.round((w * MARK.height) / MARK.width))
    const mark = await sharp(source)
      .extract(MARK)
      .resize(w, h, { kernel: 'lanczos3' })
      .png()
      .toBuffer()
    // Deux passes : sharp redimensionne avant de composer, donc agrandir le carré
    // de fond dans le même pipeline laisserait la marque à sa taille d origine.
    return sharp({ create: { width: px, height: px, channels: 4, background: BG } })
      .composite([{ input: mark, left: Math.round((px - w) / 2), top: Math.round((px - h) / 2) }])
      .png({ compressionLevel: 9 })
      .toBuffer()
  }))

  return encode(frames)
}

export function favicon(): Plugin {
  let root = process.cwd()
  let pending: Promise<Buffer> | null = null
  const ico = () => (pending ??= renderIco(root))

  return {
    name: 'b4after:favicon',
    configResolved(config) {
      root = config.root
    },
    // Servi depuis la mémoire : rien de généré ne traîne dans `public/`, et le
    // dev voit la même favicon que la production.
    configureServer(server) {
      const source = resolve(root, SOURCE)
      server.watcher.add(source)
      server.watcher.on('change', (file) => {
        if (file === source) pending = null
      })
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] !== '/favicon.ico') {
          next()
          return
        }
        ico().then((buffer) => {
          res.setHeader('Content-Type', 'image/x-icon')
          res.setHeader('Cache-Control', 'no-cache')
          res.end(buffer)
        }, next)
      })
    },
    async generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'favicon.ico', source: await ico() })
    },
  }
}
