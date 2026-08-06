import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/')
})

/**
 * Fabrique une image de test à deux bandes verticales : rouge à gauche, bleu à droite.
 * Injectée dans la page pour que les tests de rendu aient une entrée déterministe.
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

    const solid = (color) => {
      const canvas = new OffscreenCanvas(100, 150)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 100, 150)
      return canvas.transferToImageBitmap()
    }

    const frame = { width: 100, height: 150 }
    const input = (color) => ({
      source: solid(color),
      transform: IDENTITY,
      takenAt: Date.UTC(2026, 6, 31, 12),
      shot: frame,
    })

    const blob = await renderSideBySide(input('#ff0000'), input('#0000ff'), frame, {
      stamp: 'none',
      layout: 'auto',
      stampScale: 1,
    })
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
    const bitmap = window.__stripes(150, 100)
    const input = { source: bitmap, transform: IDENTITY, takenAt: 0, shot: frame }

    const decoded = await createImageBitmap(
      await renderSideBySide(input, input, frame, { stamp: 'none', layout: 'auto', stampScale: 1 }),
    )
    return { width: decoded.width, height: decoded.height }
  }, HELPERS)

  expect(size).toEqual({ width: 150, height: 208 })
})

test('renderSideBySide réserve un bandeau pour les dates', async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const bitmap = window.__stripes(100, 150)
    const input = { source: bitmap, transform: IDENTITY, takenAt: Date.UTC(2026, 6, 31, 12), shot: frame }

    const decoded = await createImageBitmap(
      await renderSideBySide(input, input, frame, { stamp: 'date', layout: 'auto', stampScale: 1 }),
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
    const bitmap = window.__stripes(100, 150)
    const input = { source: bitmap, transform: IDENTITY, takenAt: Date.UTC(2026, 6, 31, 12), shot: frame }

    const decode = async (stampScale) => {
      const decoded = await createImageBitmap(
        await renderSideBySide(input, input, frame, { stamp: 'date', layout: 'auto', stampScale }),
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
    const bitmap = window.__stripes(100, 150)
    const input = { source: bitmap, transform: IDENTITY, takenAt: 0, shot: frame }

    const decoded = await createImageBitmap(
      await renderSideBySide(input, input, frame, { stamp: 'none', layout: 'vertical', stampScale: 1 }),
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
    const bitmap = window.__stripes(150, 100)
    const input = { source: bitmap, transform: IDENTITY, takenAt: 0, shot: frame }

    const decoded = await createImageBitmap(
      await renderSideBySide(input, input, frame, { stamp: 'none', layout: 'horizontal', stampScale: 1 }),
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
    const bitmap = window.__stripes(100, 150)
    const input = {
      source: bitmap,
      transform: IDENTITY,
      takenAt: new Date(2026, 6, 31, 14, 5).getTime(),
      shot: frame,
    }

    const decoded = await createImageBitmap(
      await renderSideBySide(input, input, frame, { stamp: 'datetime', layout: 'auto', stampScale: 1 }),
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

test("renderSideBySide n'agrandit jamais mais réduit au-delà de 2048 px", async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 3000, height: 4000 }
    const bitmap = window.__stripes(300, 400)
    const input = { source: bitmap, transform: IDENTITY, takenAt: 0, shot: frame }

    const decoded = await createImageBitmap(
      await renderSideBySide(input, input, frame, { stamp: 'none', layout: 'auto', stampScale: 1 }),
    )
    return { width: decoded.width, height: decoded.height }
  }, HELPERS)

  // Facteur 2048/4000 = 0.512 : cellule de 1536 x 2048.
  expect(size).toEqual({ width: 1536 * 2 + 8, height: 2048 })
})

test('renderSideBySide réduit aussi la translation stockée', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderSideBySide } = await import('/src/render/sideBySide.ts')

    // Seul chemin qu emprunteront de vraies photos : facteur < 1 et transformation
    // non triviale. Cadre 3000x4000, donc facteur 2048/4000 = 0.512 et cellule
    // 1536x2048 ; à l échelle 2 la photo réduite fait 3072 px de large.
    const frame = { width: 3000, height: 4000 }
    const bitmap = window.__stripes(3000, 4000)
    const input = (tx) => ({
      source: bitmap,
      transform: { scale: 2, rotation: 0, tx, ty: 0 },
      takenAt: 0,
      shot: frame,
    })

    // tx = ±1000 et non ±1500 : à 1500 la translation sature le jeu disponible, la
    // frontière rouge/bleu sort de la cellule dans les deux cas et le test ne
    // discriminerait plus rien.
    const blob = await renderSideBySide(input(1000), input(-1000), frame, {
      stamp: 'none',
      layout: 'auto',
      stampScale: 1,
    })
    const decoded = await createImageBitmap(blob)
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

test('renderCrossfadeGif produit un GIF animé de 10 frames', async ({ page }) => {
  const result = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const input = (color) => {
      const canvas = new OffscreenCanvas(100, 150)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 100, 150)
      return { source: canvas.transferToImageBitmap(), transform: IDENTITY, takenAt: 0, shot: frame }
    }

    const progress = []
    const blob = await renderCrossfadeGif(input('#ff0000'), input('#0000ff'), frame, {
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

test('renderCrossfadeGif réduit la largeur à 640 px', async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 1200, height: 1600 }
    const bitmap = window.__stripes(1200, 1600)
    const input = { source: bitmap, transform: IDENTITY, takenAt: 0, shot: frame }

    const bytes = new Uint8Array(
      await (await renderCrossfadeGif(input, input, frame)).arrayBuffer(),
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
    const bitmap = window.__stripes(1280, 1600)
    const input = {
      source: bitmap,
      transform: { scale: 2, rotation: 0, tx: 320, ty: 0 },
      takenAt: 0,
      shot: frame,
    }

    const blob = await renderCrossfadeGif(input, input, frame, {})
    // createImageBitmap sur un GIF animé rend sa première frame, soit l avant pur
    // (mix = 0) : on isole ainsi la transformation de l avant.
    const first = await createImageBitmap(blob)
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
    const bitmap = window.__stripes(100, 150)
    const input = { source: bitmap, transform: IDENTITY, takenAt: 0, shot: frame }

    const controller = new AbortController()
    controller.abort()
    try {
      await renderCrossfadeGif(input, input, frame, { signal: controller.signal })
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
    const solid = (color) => {
      const canvas = new OffscreenCanvas(100, 150)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 100, 150)
      return { source: canvas.transferToImageBitmap(), transform: IDENTITY, takenAt: 0, shot: frame }
    }

    const progress = []
    const blob = await renderCrossfadeVideo(solid('#ff0000'), solid('#0000ff'), frame, {
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

test("renderCrossfadeVideo réduit la largeur à 640 px sans jamais agrandir", async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 1200, height: 1600 }
    const bitmap = window.__stripes(1200, 1600)
    const input = { source: bitmap, transform: IDENTITY, takenAt: 0, shot: frame }

    const blob = await renderCrossfadeVideo(input, input, frame)
    const url = URL.createObjectURL(blob)
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
    const bitmap = window.__stripes(100, 150)
    const input = { source: bitmap, transform: IDENTITY, takenAt: 0, shot: frame }

    const controller = new AbortController()
    controller.abort()
    try {
      await renderCrossfadeVideo(input, input, frame, { signal: controller.signal })
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
    const solid = (color) => {
      const canvas = new OffscreenCanvas(100, 150)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 100, 150)
      return { source: canvas.transferToImageBitmap(), transform: IDENTITY, takenAt: 0, shot: frame }
    }

    const blob = await renderCrossfadeVideo(solid('#ff0000'), solid('#0000ff'), frame)
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
    const input = (color) => {
      const canvas = new OffscreenCanvas(100, 150)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 100, 150)
      return { source: canvas.transferToImageBitmap(), transform: IDENTITY, takenAt: 0, shot: frame }
    }

    const progress = []
    const blob = await renderCrossfadeGif(input('#ff0000'), input('#0000ff'), frame, {
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
    const { drawTransition, scaleInput } = await import('/src/render/crossfade.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 100 }
    const input = (color) => {
      const canvas = new OffscreenCanvas(100, 100)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 100, 100)
      return { source: canvas.transferToImageBitmap(), transform: IDENTITY, takenAt: 0, shot: frame }
    }

    // On dessine directement l état à mi-course, seul moyen d observer la géométrie
    // du balayage : à mix = 0.5, la moitié gauche est l après, la droite l avant.
    // Un fondu, lui, donnerait un violet uniforme des deux côtés.
    const canvas = new OffscreenCanvas(100, 100)
    const ctx = canvas.getContext('2d')
    const from = scaleInput(input('#ff0000'), 1)
    const to = scaleInput(input('#0000ff'), 1)
    drawTransition(ctx, from, to, { width: 100, height: 100 }, 0.5, 'wipe')

    const blob = await renderCrossfadeGif(input('#ff0000'), input('#0000ff'), frame, {
      transition: 'wipe',
    })
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
    const solid = (color) => {
      const canvas = new OffscreenCanvas(100, 150)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 100, 150)
      return { source: canvas.transferToImageBitmap(), transform: IDENTITY, takenAt: 0, shot: frame }
    }

    const progress = []
    const blob = await renderCrossfadeVideo(solid('#ff0000'), solid('#0000ff'), frame, {
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

test('renderCrossfadeGif élargit à 1080 px sur demande', async ({ page }) => {
  const size = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeGif } = await import('/src/render/gif.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 1200, height: 1600 }
    const bitmap = window.__stripes(1200, 1600)
    const input = { source: bitmap, transform: IDENTITY, takenAt: 0, shot: frame }

    const bytes = new Uint8Array(
      await (
        await renderCrossfadeGif(input, input, frame, { width: 1080, transition: 'cut' })
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
    const bitmap = window.__stripes(300, 400)
    const input = { source: bitmap, transform: IDENTITY, takenAt: 0, shot: frame }

    const bytes = new Uint8Array(
      await (
        await renderCrossfadeGif(input, input, frame, { width: 1080, transition: 'cut' })
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
    const bitmap = window.__stripes(2400, 1600)
    const input = { source: bitmap, transform: IDENTITY, takenAt: 0, shot: frame }

    const bytes = new Uint8Array(
      await (
        await renderCrossfadeGif(input, input, frame, { width: 'full', transition: 'cut' })
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
  const result = await page.evaluate(async () => {
    const { renderCrossfadeVideo, HOLD_DURATION_MS } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const solid = (color) => {
      const canvas = new OffscreenCanvas(100, 150)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 100, 150)
      return { source: canvas.transferToImageBitmap(), transform: IDENTITY, takenAt: 0, shot: frame }
    }

    // Le temps réel mis par la fonction elle-même, pas la durée relue depuis le blob
    // produit : un MP4 issu de `MediaRecorder` ne restitue pas de façon fiable sa
    // propre durée totale, même en forçant son recalcul (voir `durationOf` plus bas,
    // qui reste correct en comparaison relative mais pas en valeur absolue).
    const startedAt = performance.now()
    await renderCrossfadeVideo(solid('#ff0000'), solid('#0000ff'), frame, {
      transition: 'crossfade',
      pace: 'normal',
      hold: 'short',
    })
    const elapsedMs = performance.now() - startedAt

    return { elapsedMs, holdMs: HOLD_DURATION_MS.short }
  })

  // Durée courte (700 ms) + fondu normal (1200 ms) + durée courte (700 ms) = 2,6 s.
  const expectedMs = 2 * result.holdMs + 1200
  expect(Math.abs(result.elapsedMs - expectedMs)).toBeLessThan(300)
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
      const solid = (color) => {
        const canvas = new OffscreenCanvas(100, 150)
        const ctx = canvas.getContext('2d')
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 100, 150)
        return { source: canvas.transferToImageBitmap(), transform: IDENTITY, takenAt: 0, shot: frame }
      }

      // `cut`, pas `crossfade` : la durée d affichage est ainsi le seul facteur en jeu,
      // sans le bruit d un fondu dont la durée dépend du rythme.
      const long = await renderCrossfadeVideo(solid('#ff0000'), solid('#0000ff'), frame, {
        transition: 'cut',
        hold: 'long',
      })
      const short = await renderCrossfadeVideo(solid('#ff0000'), solid('#0000ff'), frame, {
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
    const solid = (color) => {
      const canvas = new OffscreenCanvas(100, 150)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 100, 150)
      return { source: canvas.transferToImageBitmap(), transform: IDENTITY, takenAt: 0, shot: frame }
    }

    // `transition: 'cut'`, et non `crossfade` : un fondu force déjà sa toute dernière
    // frame à l état exact `mixEnd` (voir `animateFade`), ce qui masquerait un palier
    // final manquant — la vidéo se terminerait toujours sur un bleu net, correctifié
    // ou pas. La coupe, elle, n a que le dessin explicite fait juste avant le palier :
    // sans ce palier pour lui laisser le temps d être capturé par `captureStream`, la
    // vidéo s arrête sur la dernière frame effectivement échantillonnée, qui reste
    // l avant. Couleurs franches et opposées pour l avant (rouge) et l après (bleu) :
    // aucune ambiguïté possible sur ce qui est montré.
    const blob = await renderCrossfadeVideo(solid('#ff0000'), solid('#0000ff'), frame, {
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
    const solid = (color) => {
      const canvas = new OffscreenCanvas(100, 150)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 100, 150)
      return { source: canvas.transferToImageBitmap(), transform: IDENTITY, takenAt: 0, shot: frame }
    }

    // Rythme, transition et durée explicites, même s ils reprennent les défauts : la
    // fenêtre de fondu utilisée plus bas (1,2-2,4 s) en dépend directement.
    const blob = await renderCrossfadeVideo(solid('#ff0000'), solid('#0000ff'), frame, {
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
    const solid = (color) => {
      const canvas = new OffscreenCanvas(100, 150)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = color
      ctx.fillRect(0, 0, 100, 150)
      return { source: canvas.transferToImageBitmap(), transform: IDENTITY, takenAt: 0, shot: frame }
    }

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
    const slow = await renderCrossfadeVideo(solid('#ff0000'), solid('#0000ff'), frame, {
      transition: 'crossfade',
      pace: 'slow',
    })
    const fast = await renderCrossfadeVideo(solid('#ff0000'), solid('#0000ff'), frame, {
      transition: 'crossfade',
      pace: 'fast',
    })

    return { slow: await durationOf(slow), fast: await durationOf(fast) }
  }, HELPERS)

  expect(result.slow).toBeGreaterThan(result.fast)
})
