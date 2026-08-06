import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

/**
 * Fabrique une image de test à deux bandes verticales : rouge à gauche, bleu à droite.
 * Injectée dans la page pour que les tests de rendu aient une entrée déterministe.
 *
 * Deux formes : `__stripes`/`__solid` rendent un `ImageBitmap` déjà décodé, pour les
 * tests qui dessinent directement (`drawShot`) sans passer par le chemin export. Les
 * versions `Blob` (PNG, sans perte, contrairement au JPEG) sont ce que `sideBySide.ts`,
 * `video.ts` et `gif.ts` attendent désormais : ils décodent eux-mêmes, une photo à la
 * fois (voir la spec de comparaison de série, § Mémoire).
 */
const HELPERS = `
  window.__stripes = (w, h) => {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, w / 2, h)
    ctx.fillStyle = '#0000ff'
    ctx.fillRect(w / 2, 0, w / 2, h)
    return canvas.transferToImageBitmap()
  }
  window.__pixel = (ctx, x, y) => Array.from(ctx.getImageData(x, y, 1, 1).data).slice(0, 3)
  window.__stripesBlob = async (w, h) => {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ff0000'
    ctx.fillRect(0, 0, w / 2, h)
    ctx.fillStyle = '#0000ff'
    ctx.fillRect(w / 2, 0, w / 2, h)
    return canvas.convertToBlob({ type: 'image/png' })
  }
  window.__solidBlob = async (w, h, color) => {
    const canvas = new OffscreenCanvas(w, h)
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = color
    ctx.fillRect(0, 0, w, h)
    return canvas.convertToBlob({ type: 'image/png' })
  }
`

test('drawShot centre la photo dans le cadre canonique', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { drawShot } = await import('/src/render/drawShot.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    // Photo 200x100 dans un cadre 100x100 : seul le tiers central est visible,
    // soit x de 50 à 150 en coordonnées photo — moitié rouge, moitié bleue.
    const bitmap = window.__stripes(200, 100)
    const canvas = new OffscreenCanvas(100, 100)
    const ctx = canvas.getContext('2d')
    drawShot(ctx, bitmap, IDENTITY, { width: 100, height: 100 }, { width: 200, height: 100 })

    return { left: window.__pixel(ctx, 25, 50), right: window.__pixel(ctx, 75, 50) }
  }, HELPERS)

  expect(result.left).toEqual([255, 0, 0])
  expect(result.right).toEqual([0, 0, 255])
})

test('drawShot applique la translation', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { drawShot } = await import('/src/render/drawShot.ts')

    // On décale de 50 px vers la droite : la bande rouge recouvre tout le cadre.
    const bitmap = window.__stripes(200, 100)
    const canvas = new OffscreenCanvas(100, 100)
    const ctx = canvas.getContext('2d')
    drawShot(
      ctx,
      bitmap,
      { scale: 1, rotation: 0, tx: 50, ty: 0 },
      { width: 100, height: 100 },
      { width: 200, height: 100 },
    )

    return { left: window.__pixel(ctx, 10, 50), right: window.__pixel(ctx, 90, 50) }
  }, HELPERS)

  expect(result.left).toEqual([255, 0, 0])
  expect(result.right).toEqual([255, 0, 0])
})

test('drawShot restaure la transformation du contexte', async ({ page }) => {
  const isIdentity = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { drawShot } = await import('/src/render/drawShot.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const bitmap = window.__stripes(200, 100)
    const canvas = new OffscreenCanvas(100, 100)
    const ctx = canvas.getContext('2d')
    drawShot(ctx, bitmap, IDENTITY, { width: 100, height: 100 }, { width: 200, height: 100 })

    const m = ctx.getTransform()
    return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0
  }, HELPERS)

  expect(isIdentity).toBe(true)
})

test('makeThumbnail réduit le plus grand côté à 320 px', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { makeThumbnail } = await import('/src/render/thumbnail.ts')

    const bitmap = window.__stripes(1600, 1200)
    const blob = await makeThumbnail(bitmap, { width: 1600, height: 1200 })
    const decoded = await createImageBitmap(blob)
    return { type: blob.type, width: decoded.width, height: decoded.height }
  }, HELPERS)

  expect(result.type).toBe('image/jpeg')
  expect(result.width).toBe(320)
  expect(result.height).toBe(240)
})

test("makeThumbnail n'agrandit jamais", async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { makeThumbnail } = await import('/src/render/thumbnail.ts')

    const bitmap = window.__stripes(80, 60)
    const decoded = await createImageBitmap(await makeThumbnail(bitmap, { width: 80, height: 60 }))
    return { width: decoded.width, height: decoded.height }
  }, HELPERS)

  expect(size).toEqual({ width: 80, height: 60 })
})

test('renderSideBySide accole deux photos portrait horizontalement', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const input = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: Date.UTC(2026, 6, 31, 12),
      shot: frame,
    })

    const blob = await renderSideBySide(
      [await input('#ff0000'), await input('#0000ff')],
      frame,
      { stamp: 'none', layout: 'auto', stampScale: 1, width: 2048 },
    )
    const decoded = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(decoded.width, decoded.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(decoded, 0, 0)

    return {
      type: blob.type,
      width: decoded.width,
      height: decoded.height,
      left: window.__pixel(ctx, 50, 75),
      right: window.__pixel(ctx, 158, 75),
    }
  }, HELPERS)

  // 2 x 100 px + 8 px de séparateur, hauteur inchangée puisque le bandeau est absent.
  // Non-régression : mêmes dimensions qu avant l existence du réglage « Largeur »,
  // à son défaut (2048 px, jamais atteint ici).
  expect(result).toMatchObject({ type: 'image/jpeg', width: 208, height: 150 })
  expect(result.left[0]).toBeGreaterThan(200)
  expect(result.right[2]).toBeGreaterThan(200)
})

test('renderSideBySide empile deux photos paysage verticalement', async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 150, height: 100 }
    const blob = await window.__stripesBlob(150, 100)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const decoded = await createImageBitmap(
      await renderSideBySide([input, input], frame, {
        stamp: 'none',
        layout: 'auto',
        stampScale: 1,
        width: 2048,
      }),
    )
    return { width: decoded.width, height: decoded.height }
  }, HELPERS)

  expect(size).toEqual({ width: 150, height: 208 })
})

test('renderSideBySide compose une série de trois photos avec deux séparateurs', async ({
  page,
}) => {
  // Test dédié à N > 2, aux dimensions calculées à la main plutôt que dérivées de la
  // formule testée (voir la spec de comparaison de série, § Tests).
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const input = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    const blob = await renderSideBySide(
      [await input('#ff0000'), await input('#00ff00'), await input('#0000ff')],
      frame,
      { stamp: 'none', layout: 'auto', stampScale: 1, width: 2048 },
    )
    const decoded = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(decoded.width, decoded.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(decoded, 0, 0)

    return {
      width: decoded.width,
      height: decoded.height,
      first: window.__pixel(ctx, 50, 75),
      second: window.__pixel(ctx, 158, 75),
      third: window.__pixel(ctx, 266, 75),
    }
  }, HELPERS)

  // 3 cellules de 100 px, 2 séparateurs de 8 px : 3*100 + 2*8 = 316.
  expect(result.width).toBe(316)
  expect(result.height).toBe(150)
  // Des seuils, pas une égalité stricte : la sortie est du JPEG, avec son bruit de
  // quantification habituel — voir les autres tests de cette même fonction.
  expect(result.first[0]).toBeGreaterThan(200)
  expect(result.second[1]).toBeGreaterThan(200)
  expect(result.third[2]).toBeGreaterThan(200)
})

test('renderSideBySide réserve un bandeau pour les dates', async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const blob = await window.__stripesBlob(100, 150)
    const input = { blob, transform: IDENTITY, takenAt: Date.UTC(2026, 6, 31, 12), shot: frame }

    const decoded = await createImageBitmap(
      await renderSideBySide([input, input], frame, {
        stamp: 'date',
        layout: 'auto',
        stampScale: 1,
        width: 2048,
      }),
    )
    return { width: decoded.width, height: decoded.height }
  }, HELPERS)

  // Bandeau = round(100 * 0.14) = 14 px sous chaque photo.
  expect(size).toEqual({ width: 208, height: 164 })
})

test('renderSideBySide agrandit le bandeau proportionnellement à stampScale', async ({ page }) => {
  const sizes = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const blob = await window.__stripesBlob(100, 150)
    const input = { blob, transform: IDENTITY, takenAt: Date.UTC(2026, 6, 31, 12), shot: frame }

    const decode = async (stampScale) => {
      const decoded = await createImageBitmap(
        await renderSideBySide([input, input], frame, {
          stamp: 'date',
          layout: 'auto',
          stampScale,
          width: 2048,
        }),
      )
      return { width: decoded.width, height: decoded.height }
    }

    return { base: await decode(1), doubled: await decode(2), untouched: await decode(1) }
  }, HELPERS)

  // Non-régression : à stampScale 1, la géométrie est exactement celle d avant ce
  // changement — le comportement décrit par le test « réserve un bandeau ».
  expect(sizes.base).toEqual({ width: 208, height: 164 })
  expect(sizes.untouched).toEqual(sizes.base)

  // Bandeau de base = round(100 * 0.14) = 14 px ; doublé = round(100 * 0.14 * 2) = 28 px.
  // La hauteur totale doit croître exactement de la différence entre les deux bandeaux,
  // ni plus (la cellule photo ne bouge pas) ni moins (le doublement doit être honoré).
  expect(sizes.doubled.width).toBe(sizes.base.width)
  expect(sizes.doubled.height - sizes.base.height).toBe(28 - 14)
})

test('renderSideBySide empile un cadre portrait quand la disposition est forcée', async ({
  page,
}) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    // Cadre portrait : la règle automatique l accolerait horizontalement. Inverser
    // ce choix est précisément ce qui prouve que l option est honorée — un test sur
    // un cadre paysage passerait aussi avec `layout` ignoré.
    const frame = { width: 100, height: 150 }
    const blob = await window.__stripesBlob(100, 150)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const decoded = await createImageBitmap(
      await renderSideBySide([input, input], frame, {
        stamp: 'none',
        layout: 'vertical',
        stampScale: 1,
        width: 2048,
      }),
    )
    return { width: decoded.width, height: decoded.height }
  }, HELPERS)

  // 100 px de large, 2 x 150 px + 8 px de séparateur.
  expect(size).toEqual({ width: 100, height: 308 })
})

test('renderSideBySide accole un cadre paysage quand la disposition est forcée', async ({
  page,
}) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 150, height: 100 }
    const blob = await window.__stripesBlob(150, 100)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const decoded = await createImageBitmap(
      await renderSideBySide([input, input], frame, {
        stamp: 'none',
        layout: 'horizontal',
        stampScale: 1,
        width: 2048,
      }),
    )
    return { width: decoded.width, height: decoded.height }
  }, HELPERS)

  expect(size).toEqual({ width: 308, height: 100 })
})

test('renderSideBySide garde l heure dans sa cellule sans déborder sur les bords', async ({
  page,
}) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    // Cadre volontairement étroit : « JJ/MM/AAAA à HH:MM » est environ 1,7 fois plus
    // long que la date seule, alors que le corps de la police est calculé sur la
    // hauteur du bandeau. Sans garde-fou, le texte sortirait de sa cellule.
    const frame = { width: 100, height: 150 }
    const blob = await window.__stripesBlob(100, 150)
    const input = {
      blob,
      transform: IDENTITY,
      takenAt: new Date(2026, 6, 31, 14, 5).getTime(),
      shot: frame,
    }

    const decoded = await createImageBitmap(
      await renderSideBySide([input, input], frame, {
        stamp: 'datetime',
        layout: 'auto',
        stampScale: 1,
        width: 2048,
      }),
    )
    const canvas = new OffscreenCanvas(decoded.width, decoded.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(decoded, 0, 0)

    // Le bandeau est sombre (#0f172a, [15,23,42]), le texte clair (#f1f5f9,
    // [241,245,249]) : contrairement à blanc-contre-presque-blanc, ce contraste est
    // franc. On échantillonne juste à l intérieur des deux bords de la cellule, au
    // milieu de la hauteur du bandeau — un texte trop large y laisserait des pixels
    // clairs.
    const left = window.__pixel(ctx, 2, 150 + 7)
    const right = window.__pixel(ctx, 97, 150 + 7)
    return { width: decoded.width, height: decoded.height, left, right }
  }, HELPERS)

  // Bandeau = round(100 * 0.14) = 14 px, comme pour la date seule.
  expect(result).toMatchObject({ width: 208, height: 164 })
  // Sombre franc aux deux bords : le texte n a débordé ni à gauche ni à droite.
  expect(result.left[0]).toBeLessThan(100)
  expect(result.left[1]).toBeLessThan(100)
  expect(result.left[2]).toBeLessThan(100)
  expect(result.right[0]).toBeLessThan(100)
  expect(result.right[1]).toBeLessThan(100)
  expect(result.right[2]).toBeLessThan(100)
})

test("renderSideBySide n'agrandit jamais mais réduit au-delà du plafond « Largeur »", async ({
  page,
}) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 3000, height: 4000 }
    const blob = await window.__stripesBlob(300, 400)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const decoded = await createImageBitmap(
      await renderSideBySide([input, input], frame, {
        stamp: 'none',
        layout: 'auto',
        stampScale: 1,
        width: 2048,
      }),
    )
    return { width: decoded.width, height: decoded.height }
  }, HELPERS)

  // Facteur 2048/4000 = 0.512 : cellule de 1536 x 2048. Non-régression : mêmes
  // dimensions qu avec l ancienne constante imposée EXPORT_MAX_EDGE, désormais le
  // défaut du réglage « Largeur ».
  expect(size).toEqual({ width: 1536 * 2 + 8, height: 2048 })
})

test(
  'non-régression : une série de deux photos aux options par défaut produit exactement les ' +
    "dimensions d'avant l'existence du réglage « Largeur »",
  async ({ page }) => {
    // Preuve, pas affirmation (voir la spec de comparaison de série, § Tests) : ce
    // test appelle `renderSideBySide` avec `DEFAULT_EXPORT_OPTIONS.image` tel quel,
    // pas une copie recopiée à la main — si quelqu un changeait un jour ce défaut,
    // c est ce test-ci qui romprait, pas seulement celui qui fixe le littéral 2048
    // dans exportOptions.test.ts. Les littéraux attendus ci-dessous sont calculés à
    // la main, indépendamment de la formule (`fitFactor`) qu ils vérifient.
    const size = await page.evaluate(async (helpers) => {
      eval(helpers)
      const { renderSideBySide } = await import('/src/render/sideBySide.ts')
      const { DEFAULT_EXPORT_OPTIONS } = await import('/src/lib/exportOptions.ts')
      const { IDENTITY } = await import('/src/align/transform.ts')

      // Cadre portrait de 3000x4000, comme une vraie photo de 12 mégapixels environ.
      const frame = { width: 3000, height: 4000 }
      const blob = await window.__stripesBlob(300, 400)
      const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

      const decoded = await createImageBitmap(
        await renderSideBySide([input, input], frame, DEFAULT_EXPORT_OPTIONS.image),
      )
      return { width: decoded.width, height: decoded.height }
    }, HELPERS)

    // À la main : facteur = min(1, 2048 / max(3000, 4000)) = 0.512 ; cellule 1536 x
    // 2048 ; cadre portrait ⇒ accolées horizontalement ; 2 cellules + 1 séparateur de
    // 8 px = 1536*2 + 8 = 3080 de large. Le défaut affiche la date (`stamp: 'date'`) :
    // bandeau = round(1536 * 0.14) = 215 px, donc 2048 + 215 = 2263 de haut. C est
    // exactement ce que produisait EXPORT_MAX_EDGE avant de devenir le défaut de
    // l option.
    expect(size).toEqual({ width: 3080, height: 2263 })
  },
)

test('renderSideBySide honore un plafond « Largeur » réduit (1024 px)', async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 3000, height: 4000 }
    const blob = await window.__stripesBlob(300, 400)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const decoded = await createImageBitmap(
      await renderSideBySide([input, input], frame, {
        stamp: 'none',
        layout: 'auto',
        stampScale: 1,
        width: 1024,
      }),
    )
    return { width: decoded.width, height: decoded.height }
  }, HELPERS)

  // Facteur 1024/4000 = 0.256 : cellule de 768 x 1024.
  expect(size).toEqual({ width: 768 * 2 + 8, height: 1024 })
})

test('renderSideBySide lève tout plafond avec la largeur « Maximale »', async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 300, height: 400 }
    const blob = await window.__stripesBlob(300, 400)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const decoded = await createImageBitmap(
      await renderSideBySide([input, input], frame, {
        stamp: 'none',
        layout: 'auto',
        stampScale: 1,
        width: 'full',
      }),
    )
    return { width: decoded.width, height: decoded.height }
  }, HELPERS)

  // Aucune réduction : chaque cellule garde les dimensions natives du cadre.
  expect(size).toEqual({ width: 300 * 2 + 8, height: 400 })
})

test('renderSideBySide réduit aussi la translation stockée', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')

    // Seul chemin qu emprunteront de vraies photos : facteur < 1 et transformation
    // non triviale. Cadre 3000x4000, donc facteur 2048/4000 = 0.512 et cellule
    // 1536x2048 ; à l échelle 2 la photo réduite fait 3072 px de large.
    const frame = { width: 3000, height: 4000 }
    const blob = await window.__stripesBlob(3000, 4000)
    const input = (tx) => ({
      blob,
      transform: { scale: 2, rotation: 0, tx, ty: 0 },
      takenAt: 0,
      shot: frame,
    })

    // tx = ±1000 et non ±1500 : à 1500 la translation sature le jeu disponible, la
    // frontière rouge/bleu sort de la cellule dans les deux cas et le test ne
    // discriminerait plus rien.
    const blob2 = await renderSideBySide([input(1000), input(-1000)], frame, {
      stamp: 'none',
      layout: 'auto',
      stampScale: 1,
      width: 2048,
    })
    const decoded = await createImageBitmap(blob2)
    const canvas = new OffscreenCanvas(decoded.width, decoded.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(decoded, 0, 0)

    return {
      // Échantillons pris du bon côté de la frontière attendue : réduite, elle
      // tombe à x = 1280 dans la première cellule et à x = 256 dans la seconde.
      before: window.__pixel(ctx, 1400, 1024),
      after: window.__pixel(ctx, 1536 + 8 + 136, 1024),
    }
  }, HELPERS)

  // Sans la réduction, la frontière sort de la cellule et les deux échantillons
  // basculent : le premier resterait rouge, le second passerait au bleu.
  expect(result.before[2]).toBeGreaterThan(200)
  expect(result.after[0]).toBeGreaterThan(200)
})

test(
  "l export image ne garde jamais plus d'une photo décodée à la fois, quelle que soit la " +
    'longueur de la série',
  async ({ page }) => {
    // C est l assertion qui discrimine un décodage séquentiel d un décodage global :
    // un rendu qui décoderait toute la série d un coup verrait ce pic croître avec le
    // nombre de photos, pas rester à 1 (voir la spec, § Mémoire, et le rapport de cet
    // agent pour la preuve que ce test échoue bien contre une implémentation qui
    // décoderait tout par avance).
    const result = await page.evaluate(async (helpers) => {
      eval(helpers)
      const { renderSideBySide } = await import('/src/render/sideBySide.ts')
      const { IDENTITY } = await import('/src/align/transform.ts')

      let live = 0
      let peak = 0
      const originalCreate = self.createImageBitmap.bind(self)
      self.createImageBitmap = async (...args) => {
        const bitmap = await originalCreate(...args)
        live += 1
        peak = Math.max(peak, live)
        const originalClose = bitmap.close.bind(bitmap)
        bitmap.close = () => {
          live -= 1
          originalClose()
        }
        return bitmap
      }

      const frame = { width: 100, height: 150 }
      const input = async () => ({
        blob: await window.__solidBlob(100, 150, '#ff0000'),
        transform: IDENTITY,
        takenAt: 0,
        shot: frame,
      })
      const options = { stamp: 'none', layout: 'auto', stampScale: 1, width: 2048 }

      const twoPhotos = [await input(), await input()]
      peak = 0
      await renderSideBySide(twoPhotos, frame, options)
      const peakWithTwo = peak

      const sixPhotos = [await input(), await input(), await input(), await input(), await input(), await input()]
      peak = 0
      await renderSideBySide(sixPhotos, frame, options)
      const peakWithSix = peak

      return { peakWithTwo, peakWithSix, liveAtEnd: live }
    }, HELPERS)

    expect(result.peakWithTwo).toBe(1)
    expect(result.peakWithSix).toBe(1)
    expect(result.liveAtEnd).toBe(0)
  },
)

test('renderCrossfadeGif produit un GIF animé de 10 frames', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const input = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    const progress = []
    const blob = await renderCrossfadeGif([await input('#ff0000'), await input('#0000ff')], frame, {
      onProgress: (done, total) => progress.push([done, total]),
    })

    const bytes = new Uint8Array(await blob.arrayBuffer())
    return {
      type: blob.type,
      header: String.fromCharCode(...bytes.slice(0, 6)),
      // Largeur et hauteur logiques, en little-endian aux octets 6 à 9.
      width: bytes[6] | (bytes[7] << 8),
      height: bytes[8] | (bytes[9] << 8),
      trailer: bytes[bytes.length - 1],
      progress,
    }
  }, HELPERS)

  expect(result.type).toBe('image/gif')
  expect(result.header).toBe('GIF89a')
  expect(result.width).toBe(100)
  expect(result.height).toBe(150)
  expect(result.trailer).toBe(0x3b)
  expect(result.progress.at(-1)).toEqual([10, 10])
})

test('renderCrossfadeGif parcourt une série de trois photos en 19 frames', async ({ page }) => {
  // 1 palier initial + 2 intervalles x (8 frames de fondu + 1 palier) = 1 + 2*9 = 19.
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const input = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    const progress = []
    const blob = await renderCrossfadeGif(
      [await input('#ff0000'), await input('#00ff00'), await input('#0000ff')],
      frame,
      { onProgress: (done, total) => progress.push([done, total]) },
    )

    const bytes = new Uint8Array(await blob.arrayBuffer())
    return { trailer: bytes[bytes.length - 1], progress }
  }, HELPERS)

  expect(result.trailer).toBe(0x3b)
  expect(result.progress.at(-1)).toEqual([19, 19])
})

test('renderCrossfadeGif réduit la largeur à 640 px', async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 1200, height: 1600 }
    const blob = await window.__stripesBlob(1200, 1600)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const bytes = new Uint8Array(
      await (await renderCrossfadeGif([input, input], frame)).arrayBuffer(),
    )
    return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) }
  }, HELPERS)

  expect(size).toEqual({ width: 640, height: 853 })
})

test('renderCrossfadeGif réduit aussi la translation stockée', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')

    // Cadre 1280x1600 : le facteur de largeur vaut 640/1280 = 0.5 exactement, donc
    // la photo réduite fait 640x800. À l échelle 2 le jeu disponible est de 640 px,
    // et tx = 320 place la frontière rouge/bleu à x = 480. Sans la réduction de la
    // translation elle tomberait à x = 640, soit le bord de l image.
    const frame = { width: 1280, height: 1600 }
    const blob = await window.__stripesBlob(1280, 1600)
    const input = {
      blob,
      transform: { scale: 2, rotation: 0, tx: 320, ty: 0 },
      takenAt: 0,
      shot: frame,
    }

    const blob2 = await renderCrossfadeGif([input, input], frame, {})
    // createImageBitmap sur un GIF animé rend sa première frame, soit l avant pur
    // (mix = 0) : on isole ainsi la transformation de l avant.
    const first = await createImageBitmap(blob2)
    const canvas = new OffscreenCanvas(first.width, first.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(first, 0, 0)

    return {
      size: { width: first.width, height: first.height },
      red: window.__pixel(ctx, 200, 400),
      boundary: window.__pixel(ctx, 560, 400),
    }
  }, HELPERS)

  expect(result.size).toEqual({ width: 640, height: 800 })
  // x = 200 est rouge dans les deux cas, c est l ancrage de cohérence.
  expect(result.red[0]).toBeGreaterThan(200)
  // x = 560 n est bleu que si la translation a bien été réduite : 80 px de marge
  // de part et d autre, et le GIF ne dégrade pas les couleurs.
  expect(result.boundary[2]).toBeGreaterThan(200)
})

test('renderCrossfadeGif honore l annulation', async ({ page }) => {
  const message = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const blob = await window.__stripesBlob(100, 150)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const controller = new AbortController()
    controller.abort()
    try {
      await renderCrossfadeGif([input, input], frame, { signal: controller.signal })
      return 'pas d erreur'
    } catch (error) {
      return error.name
    }
  }, HELPERS)

  expect(message).toBe('AbortError')
})

test('renderCrossfadeVideo produit un MP4 non trivial', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const solid = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    const progress = []
    const blob = await renderCrossfadeVideo([await solid('#ff0000'), await solid('#0000ff')], frame, {
      onProgress: (done, total) => progress.push([done, total]),
    })

    return { type: blob.type, size: blob.size, progress }
  }, HELPERS)

  expect(result.type.startsWith('video/mp4')).toBe(true)
  // Un fichier trivial (quelques octets d en-tête vide) trahirait un flux jamais
  // vraiment enregistré ; quelques ko pour ~3,6 s de vidéo 100x150 (durée moyenne,
  // rythme normal) est le bon ordre de grandeur.
  expect(result.size).toBeGreaterThan(1000)
  expect(result.progress.length).toBeGreaterThan(0)
  const [done, total] = result.progress.at(-1)
  expect(done).toBe(total)
})

test(
  'non-régression : une série de deux photos aux options par défaut produit exactement la ' +
    "durée vidéo d'avant l'existence de la série",
  async ({ page }) => {
    // Preuve, pas affirmation (voir la spec de comparaison de série, § Tests), pour le
    // pendant vidéo du test de non-régression de `renderSideBySide` plus haut : ce
    // test appelle `renderCrossfadeVideo` avec `DEFAULT_EXPORT_OPTIONS.video` tel
    // quel. Le littéral attendu est calculé à la main, indépendamment de la formule
    // (`count * holdMs + gaps * fadeMs`) qu il vérifie.
    const result = await page.evaluate(async (helpers) => {
      eval(helpers)
      const { renderCrossfadeVideo } = await import('/src/render/video.ts')
      const { DEFAULT_EXPORT_OPTIONS } = await import('/src/lib/exportOptions.ts')
      const { IDENTITY } = await import('/src/align/transform.ts')

      const frame = { width: 100, height: 150 }
      const solid = async (color) => ({
        blob: await window.__solidBlob(100, 150, color),
        transform: IDENTITY,
        takenAt: 0,
        shot: frame,
      })

      const progress = []
      const blob = await renderCrossfadeVideo(
        [await solid('#ff0000'), await solid('#0000ff')],
        frame,
        {
          ...DEFAULT_EXPORT_OPTIONS.video,
          onProgress: (done, total) => progress.push([done, total]),
        },
      )

      return { type: blob.type, progress }
    }, HELPERS)

    // À la main : `DEFAULT_EXPORT_OPTIONS.video` vaut `hold: 'medium'` (1200 ms) et
    // `pace: 'normal'` (fondu de 1200 ms), inchangés depuis le passage unique à deux
    // photos : 2 * 1200 + 1200 = 3600 ms. C est exactement le total que produisait
    // `renderCrossfadeVideo` avant l existence de la série (voir la spec du passage
    // unique).
    expect(result.type.startsWith('video/mp4')).toBe(true)
    expect(result.progress.at(-1)).toEqual([3600, 3600])
  },
)

test("renderCrossfadeVideo réduit la largeur à 640 px sans jamais agrandir", async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 1200, height: 1600 }
    const blob = await window.__stripesBlob(1200, 1600)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const blob2 = await renderCrossfadeVideo([input, input], frame)
    const url = URL.createObjectURL(blob2)
    const video = document.createElement('video')
    video.muted = true
    video.src = url
    const result = await new Promise((resolve, reject) => {
      video.addEventListener(
        'loadedmetadata',
        () => resolve({ width: video.videoWidth, height: video.videoHeight }),
        { once: true },
      )
      video.addEventListener('error', () => reject(video.error), { once: true })
    })
    URL.revokeObjectURL(url)
    return result
  }, HELPERS)

  // Même facteur que le GIF pour le même cadre : 640/1200, cadre réduit à 640x853.
  expect(size).toEqual({ width: 640, height: 853 })
})

test('renderCrossfadeVideo honore l annulation', async ({ page }) => {
  const message = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const blob = await window.__stripesBlob(100, 150)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const controller = new AbortController()
    controller.abort()
    try {
      await renderCrossfadeVideo([input, input], frame, { signal: controller.signal })
      return 'pas d erreur'
    } catch (error) {
      return error.name
    }
  }, HELPERS)

  expect(message).toBe('AbortError')
})

test('renderCrossfadeVideo anime réellement : les frames ne sont pas identiques', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const solid = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    const blob = await renderCrossfadeVideo([await solid('#ff0000'), await solid('#0000ff')], frame)
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.src = url
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true })
      video.addEventListener('error', () => reject(video.error), { once: true })
    })

    const sampleAt = async (time) => {
      await new Promise((resolve) => {
        video.addEventListener('seeked', resolve, { once: true })
        video.currentTime = time
      })
      const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0)
      return window.__pixel(ctx, Math.floor(video.videoWidth / 2), Math.floor(video.videoHeight / 2))
    }

    // Le premier palier ("avant" pur, tout au début) et un point pris au milieu du
    // fondu (palier de 0 à 1,2 s, fondu de 1,2 à 2,4 s à durée moyenne et rythme
    // normal) : une vidéo réellement figée renverrait le même pixel aux deux instants.
    const start = await sampleAt(0.05)
    const end = await sampleAt(1.8)

    URL.revokeObjectURL(url)
    return { start, end }
  }, HELPERS)

  expect(result.start).not.toEqual(result.end)
})

test('renderCrossfadeGif ne dépense aucune frame pour une coupe franche', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const input = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    const progress = []
    const blob = await renderCrossfadeGif([await input('#ff0000'), await input('#0000ff')], frame, {
      transition: 'cut',
      onProgress: (done, total) => progress.push([done, total]),
    })

    const bytes = new Uint8Array(await blob.arrayBuffer())
    return { type: blob.type, trailer: bytes[bytes.length - 1], progress }
  }, HELPERS)

  expect(result.type).toBe('image/gif')
  expect(result.trailer).toBe(0x3b)
  // Deux paliers, aucune frame intermédiaire — contre 10 pour un fondu.
  expect(result.progress.at(-1)).toEqual([2, 2])
})

test('renderCrossfadeGif balaie l image au lieu de la fondre', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')
    const { drawTransition, decodeScaled, scaleInput } = await import('/src/render/crossfade.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 100 }
    const input = async (color) => ({
      blob: await window.__solidBlob(100, 100, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    // On dessine directement l état à mi-course, seul moyen d observer la géométrie
    // du balayage : à mix = 0.5, la moitié gauche est l après, la droite l avant.
    // Un fondu, lui, donnerait un violet uniforme des deux côtés.
    const canvas = new OffscreenCanvas(100, 100)
    const ctx = canvas.getContext('2d')
    const redInput = await input('#ff0000')
    const blueInput = await input('#0000ff')
    const from = await decodeScaled(scaleInput(redInput, 1))
    const to = await decodeScaled(scaleInput(blueInput, 1))
    drawTransition(ctx, from, to, { width: 100, height: 100 }, 0.5, 'wipe')

    const blob = await renderCrossfadeGif([redInput, blueInput], frame, { transition: 'wipe' })
    const bytes = new Uint8Array(await blob.arrayBuffer())

    return {
      left: window.__pixel(ctx, 25, 50),
      right: window.__pixel(ctx, 75, 50),
      header: String.fromCharCode(...bytes.slice(0, 6)),
    }
  }, HELPERS)

  expect(result.header).toBe('GIF89a')
  // Bleu franc à gauche, rouge franc à droite : ni l un ni l autre n est un mélange.
  expect(result.left).toEqual([0, 0, 255])
  expect(result.right).toEqual([255, 0, 0])
})

test('renderCrossfadeVideo accepte une coupe franche', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo, HOLD_DURATION_MS } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const solid = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    const progress = []
    const blob = await renderCrossfadeVideo([await solid('#ff0000'), await solid('#0000ff')], frame, {
      transition: 'cut',
      onProgress: (done, total) => progress.push([done, total]),
    })

    return { type: blob.type, size: blob.size, progress, holdMs: HOLD_DURATION_MS.medium }
  }, HELPERS)

  expect(result.type.startsWith('video/mp4')).toBe(true)
  expect(result.size).toBeGreaterThan(1000)
  // Un seul passage : palier sur l avant, aucune frame de transition (coupe franche),
  // palier sur l après — deux paliers de `holdMs` (durée par défaut, moyenne).
  // Progression temporelle, pas un compte de paliers.
  expect(result.progress.at(-1)).toEqual([2 * result.holdMs, 2 * result.holdMs])
})

test("renderCrossfadeVideo, sur une série de trois photos, joue jusqu'à la dernière et l'y termine", async ({
  page,
}) => {
  // Généralise le test « se termine sur le palier de l'après » à N > 2 : preuve
  // directe que la règle « se termine sur la dernière photo » tient aussi pour une
  // série, pas seulement pour une paire (voir la spec de comparaison de série).
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo, HOLD_DURATION_MS } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const solid = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    // Coupe franche, durée courte : trois paliers nets (rouge, vert, bleu), sans
    // frame de fondu, pour un test court.
    const blob = await renderCrossfadeVideo(
      [await solid('#ff0000'), await solid('#00ff00'), await solid('#0000ff')],
      frame,
      { transition: 'cut', hold: 'short' },
    )

    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.src = url
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true })
      video.addEventListener('error', () => reject(video.error), { once: true })
    })

    const sampleAt = async (time) => {
      await new Promise((resolve) => {
        video.addEventListener('seeked', resolve, { once: true })
        video.currentTime = time
      })
      const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0)
      return window.__pixel(ctx, Math.floor(video.videoWidth / 2), Math.floor(video.videoHeight / 2))
    }

    // 3 paliers de HOLD_DURATION_MS.short (700 ms) : rouge, vert, bleu, dans l ordre.
    // On échantillonne peu après chaque frontière.
    const holdMs = HOLD_DURATION_MS.short
    const start = await sampleAt(0.1)
    const middle = await sampleAt((holdMs + 200) / 1000)
    const end = await sampleAt((2 * holdMs + 200) / 1000)

    URL.revokeObjectURL(url)
    return { start, middle, end }
  }, HELPERS)

  // Rouge, puis vert, puis bleu : la vidéo se termine sur la dernière photo, pas sur
  // la première ni la deuxième tenue plus longtemps.
  expect(result.start[0]).toBeGreaterThan(200)
  expect(result.middle[1]).toBeGreaterThan(200)
  expect(result.end[2]).toBeGreaterThan(200)
})

test(
  "l export vidéo ne garde jamais plus de deux photos décodées à la fois, quelle que soit " +
    'la longueur de la série',
  async ({ page }) => {
    const result = await page.evaluate(async (helpers) => {
      eval(helpers)
      const { renderCrossfadeVideo } = await import('/src/render/video.ts')
      const { IDENTITY } = await import('/src/align/transform.ts')

      let live = 0
      let peak = 0
      const originalCreate = self.createImageBitmap.bind(self)
      self.createImageBitmap = async (...args) => {
        const bitmap = await originalCreate(...args)
        live += 1
        peak = Math.max(peak, live)
        const originalClose = bitmap.close.bind(bitmap)
        bitmap.close = () => {
          live -= 1
          originalClose()
        }
        return bitmap
      }

      const frame = { width: 100, height: 150 }
      const solid = async (color) => ({
        blob: await window.__solidBlob(100, 150, color),
        transform: IDENTITY,
        takenAt: 0,
        shot: frame,
      })
      const opts = { transition: 'cut' }

      const twoPhotos = [await solid('#ff0000'), await solid('#0000ff')]
      peak = 0
      await renderCrossfadeVideo(twoPhotos, frame, opts)
      const peakWithTwo = peak

      const sixPhotos = [
        await solid('#ff0000'),
        await solid('#00ff00'),
        await solid('#0000ff'),
        await solid('#ffff00'),
        await solid('#00ffff'),
        await solid('#ff00ff'),
      ]
      peak = 0
      await renderCrossfadeVideo(sixPhotos, frame, opts)
      const peakWithSix = peak

      return { peakWithTwo, peakWithSix, liveAtEnd: live }
    }, HELPERS)

    expect(result.peakWithTwo).toBeLessThanOrEqual(2)
    expect(result.peakWithSix).toBeLessThanOrEqual(2)
    expect(result.liveAtEnd).toBe(0)
  },
)

test('renderCrossfadeGif élargit à 1080 px sur demande', async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 1200, height: 1600 }
    const blob = await window.__stripesBlob(1200, 1600)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const bytes = new Uint8Array(
      await (
        await renderCrossfadeGif([input, input], frame, { width: 1080, transition: 'cut' })
      ).arrayBuffer(),
    )
    return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) }
  }, HELPERS)

  // 1080 / 1200 = 0.9 ; 1600 x 0.9 = 1440.
  expect(size).toEqual({ width: 1080, height: 1440 })
})

test("renderCrossfadeGif n'agrandit jamais un cadre plus petit que la cible", async ({
  page,
}) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 300, height: 400 }
    const blob = await window.__stripesBlob(300, 400)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const bytes = new Uint8Array(
      await (
        await renderCrossfadeGif([input, input], frame, { width: 1080, transition: 'cut' })
      ).arrayBuffer(),
    )
    return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) }
  }, HELPERS)

  // La contrainte tient dans les deux sens : demander plus grand que le cadre ne
  // fabrique pas du détail qui n existe pas.
  expect(size).toEqual({ width: 300, height: 400 })
})

test("renderCrossfadeGif plafonne à 1080 px même en qualité maximale", async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    // Cadre large : `'full'` viserait EXPORT_MAX_EDGE (2048), largement au-delà du
    // plafond du chemin GIF — c est précisément ce qui doit être retenu ici.
    const frame = { width: 2400, height: 1600 }
    const blob = await window.__stripesBlob(2400, 1600)
    const input = { blob, transform: IDENTITY, takenAt: 0, shot: frame }

    const bytes = new Uint8Array(
      await (
        await renderCrossfadeGif([input, input], frame, { width: 'full', transition: 'cut' })
      ).arrayBuffer(),
    )
    return { width: bytes[6] | (bytes[7] << 8), height: bytes[8] | (bytes[9] << 8) }
  }, HELPERS)

  // 1080 / 2400 = 0.45 ; 1600 x 0.45 = 720. Sans le plafond, la largeur viserait 2048.
  expect(size).toEqual({ width: 1080, height: 720 })
})

/** Chrome ne fiabilise pas toujours la durée d un MP4 issu de `MediaRecorder` dans ses
 *  métadonnées de chargement ; se déplacer très loin force son recalcul depuis les
 *  échantillons du flux. Même recalculée, cette durée reste une sous-estimation
 *  significative de la durée réelle (vérifié à la main : ~30 % de moins qu un
 *  chronométrage `performance.now()` autour de l appel, pourtant exact lui) — un
 *  artefact propre à ce mécanisme de relecture, pas à l enregistrement. Elle ne sert
 *  donc ici qu à une comparaison relative entre deux vidéos, jamais à une valeur
 *  absolue. Injectée dans la page comme le reste, pour rester réutilisable d un test à
 *  l autre sans dépendre d un import de module. */
const DURATION_HELPER = `
  window.__durationOf = async (blob) => {
    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.src = url
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true })
      video.addEventListener('error', () => reject(video.error), { once: true })
    })
    if (!Number.isFinite(video.duration)) {
      await new Promise((resolve) => {
        video.addEventListener('durationchange', resolve, { once: true })
        video.currentTime = 1e101
      })
    }
    const duration = video.duration
    URL.revokeObjectURL(url)
    return duration
  }
`

test('renderCrossfadeVideo dure hold + fondu + hold, à la tolérance d encodage près', async ({
  page,
}) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo, HOLD_DURATION_MS } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const solid = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    // Le temps réel mis par la fonction elle-même, pas la durée relue depuis le blob
    // produit : un MP4 issu de `MediaRecorder` ne restitue pas de façon fiable sa
    // propre durée totale, même en forçant son recalcul (voir `durationOf` plus bas,
    // qui reste correct en comparaison relative mais pas en valeur absolue).
    const startedAt = performance.now()
    await renderCrossfadeVideo([await solid('#ff0000'), await solid('#0000ff')], frame, {
      transition: 'crossfade',
      pace: 'normal',
      hold: 'short',
    })
    const elapsedMs = performance.now() - startedAt

    return { elapsedMs, holdMs: HOLD_DURATION_MS.short }
  }, HELPERS)

  // Durée courte (700 ms) + fondu normal (1200 ms) + durée courte (700 ms) = 2,6 s.
  const expectedMs = 2 * result.holdMs + 1200
  expect(Math.abs(result.elapsedMs - expectedMs)).toBeLessThan(300)
})

test("l'annonce de videoDurationMs correspond au temps réel de rendu, à la tolérance d encodage près", async ({
  page,
}) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo, videoDurationMs } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const solid = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    const inputs = [await solid('#ff0000'), await solid('#00ff00'), await solid('#0000ff')]
    const options = { transition: 'crossfade', width: 640, hold: 'medium', pace: 'normal' }
    const announcedMs = videoDurationMs(inputs.length, options)

    // Même technique que le test « dure hold + fondu + hold » ci-dessus, réutilisée
    // ici : le temps réel mis par la fonction elle-même, chronométré par
    // performance.now() autour de l appel, plutôt que la durée relue depuis le blob
    // produit — un MP4 issu de MediaRecorder ne restitue pas cette durée de façon
    // fiable dans ce banc d essai (voir DURATION_HELPER plus haut).
    let reportedTotal = null
    const startedAt = performance.now()
    await renderCrossfadeVideo(inputs, frame, {
      ...options,
      onProgress: (_done, total) => {
        reportedTotal = total
      },
    })
    const elapsedMs = performance.now() - startedAt

    return { announcedMs, elapsedMs, reportedTotal }
  }, HELPERS)

  expect(Math.abs(result.elapsedMs - result.announcedMs)).toBeLessThan(400)

  // Assertion complémentaire, plus stricte : le total transmis à `onProgress` par
  // `renderCrossfadeVideo` doit être exactement celui de `videoDurationMs`, et pas
  // seulement proche. La comparaison au temps réel ci-dessus tolère 400 ms
  // d encodage et ne remarquerait donc pas une divergence de quelques centaines de
  // millisecondes sur le total interne — celle-ci le fait, à l égalité près, parce
  // que `total` ne sert qu au calcul de progression et n influence jamais les
  // pauses réellement attendues par la boucle de rendu (voir le commentaire sur
  // `totalMs` dans video.ts).
  expect(result.reportedTotal).toBe(result.announcedMs)
})

test('renderCrossfadeVideo dure plus longtemps avec une durée de photos longue que courte, à rythme égal', async ({
  page,
}) => {
  const result = await page.evaluate(
    async (helpers) => {
      eval(helpers)
      const { renderCrossfadeVideo } = await import('/src/render/video.ts')
      const { IDENTITY } = await import('/src/align/transform.ts')

      const frame = { width: 100, height: 150 }
      const solid = async (color) => ({
        blob: await window.__solidBlob(100, 150, color),
        transform: IDENTITY,
        takenAt: 0,
        shot: frame,
      })

      // `cut`, pas `crossfade` : la durée d affichage est ainsi le seul facteur en jeu,
      // sans le bruit d un fondu dont la durée dépend du rythme.
      const long = await renderCrossfadeVideo([await solid('#ff0000'), await solid('#0000ff')], frame, {
        transition: 'cut',
        hold: 'long',
      })
      const short = await renderCrossfadeVideo([await solid('#ff0000'), await solid('#0000ff')], frame, {
        transition: 'cut',
        hold: 'short',
      })

      return { long: await window.__durationOf(long), short: await window.__durationOf(short) }
    },
    HELPERS + DURATION_HELPER,
  )

  expect(result.long).toBeGreaterThan(result.short)
})

test("renderCrossfadeVideo se termine sur le palier de l'après, pas sur la fin de la transition", async ({
  page,
}) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const solid = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    // `transition: 'cut'`, et non `crossfade` : un fondu force déjà sa toute dernière
    // frame à l état exact `mixEnd` (voir `animateFade`), ce qui masquerait un palier
    // final manquant — la vidéo se terminerait toujours sur un bleu net, correctifié
    // ou pas. La coupe, elle, n a que le dessin explicite fait juste avant le palier :
    // sans ce palier pour lui laisser le temps d être capturé par `captureStream`, la
    // vidéo s arrête sur la dernière frame effectivement échantillonnée, qui reste
    // l avant. Couleurs franches et opposées pour l avant (rouge) et l après (bleu) :
    // aucune ambiguïté possible sur ce qui est montré.
    const blob = await renderCrossfadeVideo([await solid('#ff0000'), await solid('#0000ff')], frame, {
      transition: 'cut',
      hold: 'short',
    })

    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.src = url
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true })
      video.addEventListener('error', () => reject(video.error), { once: true })
    })

    const sampleAt = async (time) => {
      await new Promise((resolve) => {
        video.addEventListener('seeked', resolve, { once: true })
        video.currentTime = time
      })
      const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0)
      return window.__pixel(ctx, Math.floor(video.videoWidth / 2), Math.floor(video.videoHeight / 2))
    }

    // Un temps hors de portée, pas `video.duration - epsilon` : ce dernier s est
    // révélé peu fiable à la main pour un MP4 issu de `MediaRecorder` (voir le
    // commentaire sur `DURATION_HELPER` plus haut, qui sous-estime la durée réelle) —
    // au point de parfois retomber dans le palier du milieu plutôt qu à la fin.
    // Chercher directement une position hors de portée force le navigateur à se
    // caler sur la toute dernière image réellement disponible, sans passer par cette
    // lecture de durée.
    const end = await sampleAt(1e101)

    URL.revokeObjectURL(url)
    return { end }
  }, HELPERS)

  // Bleu franc, pas rouge : des seuils sur chaque canal, pas une égalité stricte,
  // absorbent le bruit de quantification YUV de l encodage H.264 (`#0000ff` ressort
  // par exemple en ~[1, 1, 254]).
  expect(result.end[2]).toBeGreaterThan(200)
  expect(result.end[0]).toBeLessThan(50)
})

test('renderCrossfadeVideo anime en continu : deux instants rapprochés au milieu du fondu diffèrent', async ({
  page,
}) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const solid = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    // Rythme, transition et durée explicites, même s ils reprennent les défauts : la
    // fenêtre de fondu utilisée plus bas (1,2-2,4 s) en dépend directement.
    const blob = await renderCrossfadeVideo([await solid('#ff0000'), await solid('#0000ff')], frame, {
      transition: 'crossfade',
      pace: 'normal',
      hold: 'medium',
    })

    const url = URL.createObjectURL(blob)
    const video = document.createElement('video')
    video.muted = true
    video.src = url
    await new Promise((resolve, reject) => {
      video.addEventListener('loadedmetadata', resolve, { once: true })
      video.addEventListener('error', () => reject(video.error), { once: true })
    })

    const sampleAt = async (time) => {
      await new Promise((resolve) => {
        video.addEventListener('seeked', resolve, { once: true })
        video.currentTime = time
      })
      const canvas = new OffscreenCanvas(video.videoWidth, video.videoHeight)
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0)
      return window.__pixel(ctx, Math.floor(video.videoWidth / 2), Math.floor(video.videoHeight / 2))
    }

    // Deux instants à 40 ms d écart, tous deux dans la fenêtre de fondu (1,2-2,4 s à
    // durée moyenne et rythme normal). C est l assertion qui discrimine : une
    // animation par paliers fixes rendrait le même pixel aux deux instants tant qu ils
    // tombent dans le même palier ; une animation pilotée par le temps écoulé ne peut
    // pas produire deux pixels identiques à deux instants différents du fondu.
    const first = await sampleAt(1.5)
    const second = await sampleAt(1.54)

    URL.revokeObjectURL(url)
    return { first, second }
  }, HELPERS)

  expect(result.first).not.toEqual(result.second)
})

test("renderCrossfadeVideo dure plus longtemps au rythme lent qu'au rythme rapide, pour le même nombre d'allers-retours", async ({
  page,
}) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const solid = async (color) => ({
      blob: await window.__solidBlob(100, 150, color),
      transform: IDENTITY,
      takenAt: 0,
      shot: frame,
    })

    // Contournement Chrome connu : un MP4 issu de `MediaRecorder` ne porte pas
    // toujours sa durée totale dans ses métadonnées de chargement ; se déplacer très
    // loin force le navigateur à la recalculer depuis les échantillons du flux.
    const durationOf = async (blob) => {
      const url = URL.createObjectURL(blob)
      const video = document.createElement('video')
      video.muted = true
      video.src = url
      await new Promise((resolve, reject) => {
        video.addEventListener('loadedmetadata', resolve, { once: true })
        video.addEventListener('error', () => reject(video.error), { once: true })
      })
      if (!Number.isFinite(video.duration)) {
        await new Promise((resolve) => {
          video.addEventListener('durationchange', resolve, { once: true })
          video.currentTime = 1e101
        })
      }
      const duration = video.duration
      URL.revokeObjectURL(url)
      return duration
    }

    // `crossfade`, pas `cut` : le rythme n a d effet que sur un fondu (voir video.ts).
    const slow = await renderCrossfadeVideo([await solid('#ff0000'), await solid('#0000ff')], frame, {
      transition: 'crossfade',
      pace: 'slow',
    })
    const fast = await renderCrossfadeVideo([await solid('#ff0000'), await solid('#0000ff')], frame, {
      transition: 'crossfade',
      pace: 'fast',
    })

    return { slow: await durationOf(slow), fast: await durationOf(fast) }
  }, HELPERS)

  expect(result.slow).toBeGreaterThan(result.fast)
})

test(
  "renderCrossfadeVideo : la durée de contenu réellement produite rejoint celle qu'annonce " +
    'videoDurationMs, palier final compris',
  async ({ page }) => {
    // Aucun test existant ne mesure la durée de contenu de la vidéo produite : les
    // tests ci-dessus chronomètrent l appel (correct, la fonction attend bien le bon
    // temps) ou lisent la dernière frame disponible (correcte elle aussi, mais la
    // même que celle montrée par une vidéo dont le palier final a été purement et
    // simplement coupé par `captureStream`, faute de redessin — voir `holdFrame`
    // dans video.ts). C est cette mesure-ci, et elle seule, qui aurait détecté le
    // bug : palier long (2000 ms, `HOLD_DURATION_MS.long`) et fondu rapide (700 ms,
    // `FADE_DURATION_MS.fast`) sur trois photos rendent l écart — la durée d un
    // palier entier manquant — assez large pour ne laisser aucune place au doute.
    const result = await page.evaluate(async (helpers) => {
      eval(helpers)
      const { renderCrossfadeVideo, videoDurationMs } = await import('/src/render/video.ts')
      const { IDENTITY } = await import('/src/align/transform.ts')

      const frame = { width: 100, height: 150 }
      const solid = async (color) => ({
        blob: await window.__solidBlob(100, 150, color),
        transform: IDENTITY,
        takenAt: 0,
        shot: frame,
      })

      const inputs = [await solid('#ff0000'), await solid('#00ff00'), await solid('#0000ff')]
      const options = { transition: 'crossfade', width: 640, hold: 'long', pace: 'fast' }
      const announcedMs = videoDurationMs(inputs.length, options)

      const blob = await renderCrossfadeVideo(inputs, frame, options)
      const contentMs = (await window.__durationOf(blob)) * 1000

      return { announcedMs, contentMs }
    }, HELPERS + DURATION_HELPER)

    // Tolérance large (1 s) : elle ne vise pas à mesurer l encodage au plus juste,
    // seulement à distinguer sans ambiguïté un palier final bien capturé (écart de
    // quelques centaines de ms, le bruit habituel de l encodage et de la relecture)
    // d une vidéo qui s arrête à la fin de la dernière transition (écart de l ordre
    // du palier entier manquant, ici 2000 ms).
    expect(Math.abs(result.contentMs - result.announcedMs)).toBeLessThan(1000)
  },
)

test('importPhoto ré-encode une photo importée en JPEG, aux dimensions de la source, avec une vignette', async ({
  page,
}) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { importPhoto } = await import('/src/capture/importPhoto.ts')

    // Source en PNG, distincte du JPEG attendu en sortie : ça vérifie que le format
    // est bien homogénéisé, pas simplement recopié.
    const bitmap = window.__stripes(640, 480)
    const canvas = new OffscreenCanvas(640, 480)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    const pngBlob = await canvas.convertToBlob({ type: 'image/png' })
    const file = new File([pngBlob], 'photo.png', { type: 'image/png' })

    const captured = await importPhoto(file)
    const encoded = await captured.encoding.result()

    const decoded = await createImageBitmap(encoded.blob)
    const thumb = await createImageBitmap(encoded.thumbBlob)

    return {
      capturedSize: { width: captured.width, height: captured.height },
      blobType: encoded.blob.type,
      decodedSize: { width: decoded.width, height: decoded.height },
      thumbType: encoded.thumbBlob.type,
      thumbSize: { width: thumb.width, height: thumb.height },
    }
  }, HELPERS)

  expect(result.capturedSize).toEqual({ width: 640, height: 480 })
  expect(result.blobType).toBe('image/jpeg')
  expect(result.decodedSize).toEqual({ width: 640, height: 480 })
  expect(result.thumbType).toBe('image/jpeg')
  expect(result.thumbSize).toEqual({ width: 320, height: 240 })
})

test('importPhoto rejette un fichier illisible par une erreur, pas par un plantage', async ({
  page,
}) => {
  const message = await page.evaluate(async () => {
    const { importPhoto } = await import('/src/capture/importPhoto.ts')
    // Quelques octets sans rapport avec un JPEG : `createImageBitmap` doit rejeter,
    // pas planter la page.
    const file = new File([new Uint8Array([1, 2, 3, 4, 5])], 'invalide.jpg', {
      type: 'image/jpeg',
    })
    try {
      await importPhoto(file)
      return 'pas d erreur'
    } catch (error) {
      return error instanceof Error ? error.message || error.name : String(error)
    }
  })

  expect(message).not.toBe('pas d erreur')
})
