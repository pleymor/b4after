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
