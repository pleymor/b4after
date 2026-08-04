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
      showDates: false,
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

  // 2 x 100 px + 8 px de séparateur, hauteur inchangée puisque showDates est faux.
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
      await renderSideBySide(input, input, frame, { showDates: false }),
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
      await renderSideBySide(input, input, frame, { showDates: true }),
    )
    return { width: decoded.width, height: decoded.height }
  }, HELPERS)

  // Bandeau = round(100 * 0.14) = 14 px sous chaque photo.
  expect(size).toEqual({ width: 208, height: 164 })
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
      await renderSideBySide(input, input, frame, { showDates: false }),
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
    const blob = await renderSideBySide(input(1000), input(-1000), frame, { showDates: false })
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
  // vraiment enregistré ; quelques ko pour ~3,4 s de vidéo 100x150 est le bon ordre
  // de grandeur.
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

    // Le premier palier ("avant" pur, tout au début) et un point pris près de la
    // fin du premier fondu (à 1,05 s sur une fenêtre de fondu 0,5-1,14 s) : une
    // vidéo réellement figée renverrait le même pixel aux deux instants.
    const start = await sampleAt(0.05)
    const end = await sampleAt(1.05)

    URL.revokeObjectURL(url)
    return { start, end }
  }, HELPERS)

  expect(result.start).not.toEqual(result.end)
})
