# Options d'export de la comparaison — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les deux boutons d'export pleine largeur de l'écran Comparaison par une barre fixe à icônes, chacune ouvrant une feuille modale qui porte les réglages de cet export et le bouton qui le lance.

**Architecture :** Un modèle d'options typé et validé (`src/lib/exportOptions.ts`) mémorisé en `localStorage`, traversé jusqu'aux fonctions de rendu qui étaient jusqu'ici pilotées par des constantes. Côté rendu, le bloc de mélange dupliqué entre `gif.ts` et `video.ts` est extrait dans `crossfade.ts`, qui devient le seul endroit où une transition est définie. Côté interface, `Screen` gagne un pied de page hors du conteneur défilant — donc fixe par construction — et un composant `Sheet` générique porte les deux feuilles.

**Tech Stack :** React 19, TypeScript, Tailwind 4, Vitest (environnement node), Playwright.

**Spec :** `docs/superpowers/specs/2026-08-05-options-export-design.md`

## Global Constraints

- Interface **en français uniquement**. Aucune chaîne en anglais visible par l'utilisateur.
- **Les défauts reproduisent exactement le comportement actuel** : `{ image: { stamp: 'date', layout: 'auto' }, video: { transition: 'crossfade', width: 640, reps: 3 } }`. Un utilisateur qui ne touche à rien ne doit voir aucun changement de rendu.
- **Aucun appel réseau à l'exécution.** Pas de police web, pas de CDN, **aucune bibliothèque d'icônes** — les deux glyphes sont du SVG inline.
- Clé de stockage : **`b4after.exportOptions`**, valeur JSON.
- Tout accès à `localStorage` est enveloppé d'un `try` / `catch`. Perdre la mémorisation d'un réglage est sans gravité et ne mérite **aucun message**.
- `parseExportOptions` **ne jette jamais** et valide **champ par champ** : une valeur inconnue retombe sur le défaut de ce champ seul, pas sur le défaut complet.
- Les exports **n'agrandissent jamais** : le facteur d'échelle reste `Math.min(1, cible / frame.width)` partout.
- Plafond absolu de largeur d'export : **`EXPORT_MAX_EDGE` (2048)**, déjà exporté par `src/render/sideBySide.ts`.
- Rythme d'animation inchangé : paliers **`GIF_HOLD_MS` (500 ms)**, pas de fondu **`GIF_STEP_MS` (80 ms)**, **`GIF_STEPS` (10)** frames pour un fondu.
- `data-testid` à préserver tels quels : `export-jpeg`, `export-gif`, `export-progress`, `cancel-export`, `export-status`, `reveal-slider`, `reveal-handle`. `toggle-dates` disparaît.
- Environnement de test unitaire = **node** : ni `window`, ni `document`, ni `localStorage`. Les stubber avec `vi.stubGlobal`, sur le modèle de `src/share/shareOrDownload.test.ts`.
- Messages de commit en français, préfixe conventionnel (`feat:`, `test:`, `refactor:`, `chore:`).
- Dans le code livré, tout texte visible porte une vraie apostrophe droite (`'`), en échappant la chaîne si nécessaire (`"L'export…"`).

## File Structure

| Fichier | Responsabilité |
| --- | --- |
| `src/lib/exportOptions.ts` | **Nouveau.** Types des options, défauts, validation champ par champ, lecture/écriture `localStorage`. Aucune dépendance à React ni au DOM hors `localStorage`. |
| `src/lib/exportOptions.test.ts` | **Nouveau.** Unitaire. |
| `src/lib/format.ts` | **Modifié.** Ajout de `formatDateTime`. |
| `src/render/crossfade.ts` | **Nouveau.** `ScaledInput`, `drawTransition`, `transitionSteps`. Seul endroit où une transition est définie. |
| `src/render/crossfade.test.ts` | **Nouveau.** Unitaire, sur `transitionSteps` seul (le dessin exige un canvas, donc de l'e2e). |
| `src/render/sideBySide.ts` | **Modifié.** `options: ImageOptions`, bandeau date/heure, disposition forcée. |
| `src/render/gif.ts` | **Modifié.** Accepte `transition` et `width`, délègue le dessin à `crossfade.ts`. |
| `src/render/video.ts` | **Modifié.** Accepte `transition`, `width` et `reps` ; `REPS` disparaît. |
| `src/ui/components/Screen.tsx` | **Modifié.** Prop `footer`, rendue hors du conteneur défilant. |
| `src/ui/components/Sheet.tsx` | **Nouveau.** Feuille modale générique, sans logique métier. |
| `src/ui/components/icons.tsx` | **Nouveau.** Deux icônes SVG inline. |
| `src/ui/components/OptionRow.tsx` | **Nouveau.** Une ligne de réglage = un libellé + un groupe de boutons à choix unique. Trois usages côté image, trois côté vidéo : le factoriser évite six copies du même balisage. |
| `src/hooks/useExportOptions.ts` | **Nouveau.** État React adossé à `exportOptions.ts`, écriture au changement. |
| `src/ui/CompareScreen.tsx` | **Modifié.** Barre du bas, deux feuilles, câblage des options. |
| `e2e/render.spec.ts` | **Modifié.** Appels mis à jour + nouveaux cas de disposition, de bandeau, de transition et de largeur. |
| `e2e/flow.spec.ts` | **Modifié.** Ouverture de feuille avant chaque export + mémorisation + absence de défilement. |

---

### Task 1: Modèle d'options et persistance

**Files:**
- Create: `src/lib/exportOptions.ts`
- Test: `src/lib/exportOptions.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: les types `StampMode`, `Layout`, `Transition`, `VideoWidth`, `VideoLength`, `ImageOptions`, `VideoOptions`, `ExportOptions` ; les valeurs `STORAGE_KEY`, `DEFAULT_EXPORT_OPTIONS` ; les fonctions `parseExportOptions(raw: string | null): ExportOptions`, `loadExportOptions(): ExportOptions`, `saveExportOptions(options: ExportOptions): void`. Toutes les tâches suivantes importent depuis `@/lib/exportOptions`.

- [ ] **Step 1: Write the failing test**

Créer `src/lib/exportOptions.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_EXPORT_OPTIONS,
  loadExportOptions,
  parseExportOptions,
  saveExportOptions,
  STORAGE_KEY,
} from './exportOptions'

/** Faux `localStorage` en mémoire, avec des crochets pour simuler ses pannes. */
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial))
  const storage = {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => void store.set(key, value)),
  }
  vi.stubGlobal('localStorage', storage)
  return storage
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('parseExportOptions', () => {
  it('rend les défauts sans valeur stockée', () => {
    expect(parseExportOptions(null)).toEqual(DEFAULT_EXPORT_OPTIONS)
  })

  it('rend les défauts sur un JSON illisible', () => {
    expect(parseExportOptions('{pas du json')).toEqual(DEFAULT_EXPORT_OPTIONS)
  })

  it('rend les défauts quand la racine n est pas un objet', () => {
    expect(parseExportOptions('42')).toEqual(DEFAULT_EXPORT_OPTIONS)
    expect(parseExportOptions('null')).toEqual(DEFAULT_EXPORT_OPTIONS)
  })

  it('relit une valeur complète', () => {
    const stored = {
      image: { stamp: 'datetime', layout: 'vertical' },
      video: { transition: 'wipe', width: 1080, reps: 5 },
    }
    expect(parseExportOptions(JSON.stringify(stored))).toEqual(stored)
  })

  it('complète les champs absents sans toucher aux autres', () => {
    const parsed = parseExportOptions('{"image":{"layout":"horizontal"}}')

    expect(parsed.image.layout).toBe('horizontal')
    expect(parsed.image.stamp).toBe(DEFAULT_EXPORT_OPTIONS.image.stamp)
    expect(parsed.video).toEqual(DEFAULT_EXPORT_OPTIONS.video)
  })

  it('isole une valeur inconnue au champ fautif', () => {
    // Le cœur de la fonction : une version future ou un bricolage à la main ne doit
    // pas faire perdre les réglages voisins, ni vider l écran de comparaison.
    const parsed = parseExportOptions(
      '{"image":{"stamp":"martien","layout":"vertical"},"video":{"width":9999,"reps":3}}',
    )

    expect(parsed.image.stamp).toBe(DEFAULT_EXPORT_OPTIONS.image.stamp)
    expect(parsed.image.layout).toBe('vertical')
    expect(parsed.video.width).toBe(DEFAULT_EXPORT_OPTIONS.video.width)
    expect(parsed.video.reps).toBe(3)
  })
})

describe('loadExportOptions / saveExportOptions', () => {
  it('fait un aller-retour fidèle', () => {
    stubStorage()
    const options = {
      image: { stamp: 'none', layout: 'horizontal' },
      video: { transition: 'cut', width: 'full', reps: 1 },
    } as const

    saveExportOptions(options)

    expect(loadExportOptions()).toEqual(options)
  })

  it('écrit sous la clé attendue', () => {
    const storage = stubStorage()

    saveExportOptions(DEFAULT_EXPORT_OPTIONS)

    expect(storage.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify(DEFAULT_EXPORT_OPTIONS),
    )
  })

  it('ne propage pas une écriture impossible', () => {
    const storage = stubStorage()
    storage.setItem.mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError')
    })

    // En navigation privée, `setItem` peut lever : perdre la mémorisation est sans
    // gravité, planter l écran d export ne l est pas.
    expect(() => saveExportOptions(DEFAULT_EXPORT_OPTIONS)).not.toThrow()
  })

  it('rend les défauts quand la lecture elle-même lève', () => {
    const storage = stubStorage()
    storage.getItem.mockImplementation(() => {
      throw new DOMException('bloqué', 'SecurityError')
    })

    expect(loadExportOptions()).toEqual(DEFAULT_EXPORT_OPTIONS)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/exportOptions.test.ts`
Expected: FAIL — `Failed to resolve import "./exportOptions"`.

- [ ] **Step 3: Write minimal implementation**

Créer `src/lib/exportOptions.ts` :

```ts
export type StampMode = 'none' | 'date' | 'datetime'
export type Layout = 'auto' | 'horizontal' | 'vertical'
export type Transition = 'crossfade' | 'cut' | 'wipe'
/** Largeur cible d un export animé ; `'full'` = la largeur du cadre, plafonnée. */
export type VideoWidth = 640 | 1080 | 'full'
/** Nombre d allers-retours joués à la suite. */
export type VideoLength = 1 | 3 | 5

export type ImageOptions = { stamp: StampMode; layout: Layout }
export type VideoOptions = { transition: Transition; width: VideoWidth; reps: VideoLength }
export type ExportOptions = { image: ImageOptions; video: VideoOptions }

export const STORAGE_KEY = 'b4after.exportOptions'

// Ces défauts reproduisent le comportement d avant l existence des options : bandeau
// de dates affiché, disposition déduite de l orientation du cadre, fondu enchaîné de
// trois allers-retours à 640 px. Les changer changerait le rendu de tous ceux qui
// n ont jamais ouvert une feuille de réglages.
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  image: { stamp: 'date', layout: 'auto' },
  video: { transition: 'crossfade', width: 640, reps: 3 },
}

export const STAMP_MODES: readonly StampMode[] = ['none', 'date', 'datetime']
export const LAYOUTS: readonly Layout[] = ['auto', 'horizontal', 'vertical']
export const TRANSITIONS: readonly Transition[] = ['crossfade', 'cut', 'wipe']
export const VIDEO_WIDTHS: readonly VideoWidth[] = [640, 1080, 'full']
export const VIDEO_LENGTHS: readonly VideoLength[] = [1, 3, 5]

/** Rend `value` si elle fait partie des valeurs admises, sinon le défaut du champ. */
function oneOf<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Rend l objet tel quel s il en est un, sinon un objet vide — jamais `null`. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/**
 * Relit des options stockées. Ne jette jamais et valide champ par champ : une valeur
 * écrite par une version future, tronquée ou modifiée à la main ne doit pas pouvoir
 * vider l écran de comparaison, ni faire perdre les réglages voisins.
 */
export function parseExportOptions(raw: string | null): ExportOptions {
  if (!raw) return DEFAULT_EXPORT_OPTIONS

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_EXPORT_OPTIONS
  }

  const root = asRecord(parsed)
  const image = asRecord(root.image)
  const video = asRecord(root.video)
  const fallback = DEFAULT_EXPORT_OPTIONS

  return {
    image: {
      stamp: oneOf(STAMP_MODES, image.stamp, fallback.image.stamp),
      layout: oneOf(LAYOUTS, image.layout, fallback.image.layout),
    },
    video: {
      transition: oneOf(TRANSITIONS, video.transition, fallback.video.transition),
      width: oneOf(VIDEO_WIDTHS, video.width, fallback.video.width),
      reps: oneOf(VIDEO_LENGTHS, video.reps, fallback.video.reps),
    },
  }
}

export function loadExportOptions(): ExportOptions {
  try {
    return parseExportOptions(localStorage.getItem(STORAGE_KEY))
  } catch {
    // `localStorage` peut lever à la simple lecture quand le stockage est bloqué.
    return DEFAULT_EXPORT_OPTIONS
  }
}

export function saveExportOptions(options: ExportOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
  } catch {
    // Navigation privée ou quota atteint : le réglage s applique à l export en cours
    // mais n est pas mémorisé. Rien à dire à l utilisateur.
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/exportOptions.test.ts`
Expected: PASS — 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/exportOptions.ts src/lib/exportOptions.test.ts
git commit -m "feat: modèle d'options d'export mémorisé en localStorage"
```

---

### Task 2: `formatDateTime`

**Files:**
- Modify: `src/lib/format.ts`
- Test: `src/lib/format.test.ts`

**Interfaces:**
- Consumes: `formatDate` de `src/lib/format.ts`.
- Produces: `formatDateTime(timestamp: number): string` → `'31/07/2026 à 14:05'`. Consommé par la Task 3.

- [ ] **Step 1: Write the failing test**

Ajouter à `src/lib/format.test.ts`, après le `describe('formatDate', …)` existant, et compléter la ligne d'import en `import { formatDate, formatDateTime } from './format'` :

```ts
describe('formatDateTime', () => {
  it('formate en JJ/MM/AAAA à HH:MM', () => {
    // Date construite en heure **locale**, pas en UTC : la fonction lit `getHours`,
    // donc un timestamp UTC donnerait une heure différente selon le fuseau de la
    // machine de test et ce test échouerait ailleurs qu à Paris.
    expect(formatDateTime(new Date(2026, 6, 31, 14, 5).getTime())).toBe('31/07/2026 à 14:05')
  })

  it('complète les heures et minutes à un chiffre', () => {
    expect(formatDateTime(new Date(2026, 0, 5, 9, 7).getTime())).toBe('05/01/2026 à 09:07')
  })

  it('affiche minuit sans le confondre avec midi', () => {
    expect(formatDateTime(new Date(2026, 0, 5, 0, 0).getTime())).toBe('05/01/2026 à 00:00')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/format.test.ts`
Expected: FAIL — `formatDateTime is not a function`.

- [ ] **Step 3: Write minimal implementation**

Ajouter à la fin de `src/lib/format.ts` :

```ts
/** Formate un timestamp epoch ms en JJ/MM/AAAA à HH:MM, dans le fuseau local. */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${formatDate(timestamp)} à ${hours}:${minutes}`
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/format.test.ts`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/format.ts src/lib/format.test.ts
git commit -m "feat: formatDateTime pour le bandeau des exports"
```

---

### Task 3: Bandeau date/heure et disposition forcée pour l'image côte-à-côte

**Files:**
- Modify: `src/render/sideBySide.ts`
- Modify: `src/ui/CompareScreen.tsx:105` (adapter l'appel, sans encore toucher à l'interface)
- Test: `e2e/render.spec.ts`

**Interfaces:**
- Consumes: `ImageOptions` de `@/lib/exportOptions` (Task 1), `formatDateTime` de `@/lib/format` (Task 2).
- Produces: `renderSideBySide(before, after, frame, options: ImageOptions): Promise<Blob>`. La signature perd `{ showDates: boolean }`.

- [ ] **Step 1: Mettre à jour les trois appels e2e existants**

`e2e/render.spec.ts` compte **cinq** appels à `renderSideBySide` à mettre à jour. Les
localiser par `grep -n showDates e2e/render.spec.ts`, puis :

| Test | Ancien argument | Nouveau |
| --- | --- | --- |
| accole deux photos portrait horizontalement | `showDates: false` (sur trois lignes) | `{ stamp: 'none', layout: 'auto' }` |
| empile deux photos paysage verticalement | `{ showDates: false }` | `{ stamp: 'none', layout: 'auto' }` |
| réserve un bandeau pour les dates | `{ showDates: true }` | `{ stamp: 'date', layout: 'auto' }` |
| n'agrandit jamais mais réduit au-delà de 2048 px | `{ showDates: false }` | `{ stamp: 'none', layout: 'auto' }` |
| réduit aussi la translation stockée | `{ showDates: false }` | `{ stamp: 'none', layout: 'auto' }` |

Après ce remplacement, `grep -c showDates e2e/render.spec.ts` doit rendre `0`. Les
attentes de dimensions de ces cinq tests ne changent pas : `layout: 'auto'` conserve la
règle d'origine, et c'est précisément ce qu'on vérifie ainsi.

- [ ] **Step 2: Écrire les nouveaux tests e2e**

Ajouter à `e2e/render.spec.ts`, après le test « réserve un bandeau pour les dates » :

```ts
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
      await renderSideBySide(input, input, frame, { stamp: 'none', layout: 'vertical' }),
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
      await renderSideBySide(input, input, frame, { stamp: 'none', layout: 'horizontal' }),
    )
    return { width: decoded.width, height: decoded.height }
  }, HELPERS)

  expect(size).toEqual({ width: 308, height: 100 })
})

test('renderSideBySide écrit l heure sans déborder du bandeau', async ({ page }) => {
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
      await renderSideBySide(input, input, frame, { stamp: 'datetime', layout: 'auto' }),
    )
    const canvas = new OffscreenCanvas(decoded.width, decoded.height)
    const ctx = canvas.getContext('2d')
    ctx.drawImage(decoded, 0, 0)

    // Le bandeau est le sombre sous la première cellule ; le séparateur entre les
    // deux cellules, lui, reste blanc. Un texte débordant y laisserait des pixels
    // clairs : on échantillonne la colonne du séparateur sur la hauteur du bandeau.
    const gutter = window.__pixel(ctx, 103, 150 + 7)
    return { width: decoded.width, height: decoded.height, gutter }
  }, HELPERS)

  // Bandeau = round(100 * 0.14) = 14 px, comme pour la date seule.
  expect(result).toMatchObject({ width: 208, height: 164 })
  // Blanc franc : rien du texte n a franchi la cellule.
  expect(result.gutter[0]).toBeGreaterThan(200)
  expect(result.gutter[1]).toBeGreaterThan(200)
  expect(result.gutter[2]).toBeGreaterThan(200)
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx playwright test e2e/render.spec.ts -g renderSideBySide`
Expected: FAIL — les deux tests de disposition forcée rendent les dimensions de la règle automatique (`208 × 150` au lieu de `100 × 308`, `150 × 208` au lieu de `308 × 100`), et le test datetime échoue sur le type de `options`.

- [ ] **Step 4: Write minimal implementation**

Remplacer le contenu de `src/render/sideBySide.ts` par :

```ts
import type { ImageOptions } from '@/lib/exportOptions'
import { formatDate, formatDateTime } from '@/lib/format'
import type { Size, Transform } from '@/types'
import { drawShot, type Drawable } from './drawShot'
import { fitFactor } from './thumbnail'

export const EXPORT_MAX_EDGE = 2048
export const EXPORT_QUALITY = 0.85
export const GUTTER = 8

export type ComparisonInput = {
  source: Drawable
  transform: Transform
  takenAt: number
  /** Dimensions natives de la photo, pas celles du cadre. */
  shot: Size
}

/**
 * Réduit le corps de la police jusqu à ce que `text` tienne dans `maxWidth`, et pose
 * la police retenue sur le contexte.
 *
 * Le corps est calculé sur la hauteur du bandeau, qui ne dit rien de la longueur du
 * texte : « JJ/MM/AAAA à HH:MM » est environ 1,7 fois plus long que la date seule et
 * déborderait d une cellule étroite.
 */
function setFittedFont(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startSize: number,
): void {
  let size = startSize
  ctx.font = `${size}px sans-serif`
  // Plancher à 6 px : en dessous le texte est illisible de toute façon, et la boucle
  // doit se terminer même sur un cadre absurdement étroit.
  while (size > 6 && ctx.measureText(text).width > maxWidth) {
    size -= 1
    ctx.font = `${size}px sans-serif`
  }
}

export async function renderSideBySide(
  before: ComparisonInput,
  after: ComparisonInput,
  frame: Size,
  options: ImageOptions,
): Promise<Blob> {
  const factor = fitFactor(frame, EXPORT_MAX_EDGE)
  const cellWidth = Math.round(frame.width * factor)
  const cellHeight = Math.round(frame.height * factor)
  const showStamp = options.stamp !== 'none'
  const bandHeight = showStamp ? Math.round(cellWidth * 0.14) : 0

  // `'auto'` conserve la règle d origine : un cadre en portrait se lit mieux côte à
  // côte, un cadre en paysage empilé.
  const horizontal =
    options.layout === 'auto' ? frame.height > frame.width : options.layout === 'horizontal'

  const canvas = new OffscreenCanvas(
    horizontal ? cellWidth * 2 + GUTTER : cellWidth,
    horizontal ? cellHeight + bandHeight : (cellHeight + bandHeight) * 2 + GUTTER,
  )
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Contexte 2D indisponible')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const cells = [before, after].map((input, index) => ({
    input,
    x: horizontal ? index * (cellWidth + GUTTER) : 0,
    y: horizontal ? 0 : index * (cellHeight + bandHeight + GUTTER),
  }))

  for (const { input, x, y } of cells) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, cellWidth, cellHeight)
    ctx.clip()
    ctx.translate(x, y)
    // Le cadre est passé à l échelle d export : la transformation stockée est en
    // pixels du cadre canonique, `scale` la suit donc proportionnellement.
    drawShot(
      ctx,
      input.source,
      { ...input.transform, tx: input.transform.tx * factor, ty: input.transform.ty * factor },
      { width: cellWidth, height: cellHeight },
      { width: input.shot.width * factor, height: input.shot.height * factor },
    )
    ctx.restore()

    if (showStamp) {
      const label =
        options.stamp === 'datetime' ? formatDateTime(input.takenAt) : formatDate(input.takenAt)

      ctx.fillStyle = '#0f172a'
      ctx.fillRect(x, y + cellHeight, cellWidth, bandHeight)
      ctx.fillStyle = '#f1f5f9'
      setFittedFont(ctx, label, cellWidth * 0.92, Math.round(bandHeight * 0.62))
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(label, x + cellWidth / 2, y + cellHeight + bandHeight / 2)
    }
  }

  return canvas.convertToBlob({ type: 'image/jpeg', quality: EXPORT_QUALITY })
}
```

- [ ] **Step 5: Adapter l'appel de `CompareScreen`**

Le type ne compile plus tant que l'appel passe `{ showDates }`. Sans encore toucher à l'interface, dans `src/ui/CompareScreen.tsx` remplacer la ligne 105 :

```tsx
      const blob = await renderSideBySide(inputs.before, inputs.after, frame, {
        stamp: showDates ? 'date' : 'none',
        layout: 'auto',
      })
```

L'état `showDates` et sa case à cocher restent en place jusqu'à la Task 10 : cette tâche livre le rendu, pas l'interface.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsc -b && npx playwright test e2e/render.spec.ts -g renderSideBySide`
Expected: PASS — les 5 tests existants plus les 3 nouveaux.

- [ ] **Step 7: Commit**

```bash
git add src/render/sideBySide.ts src/ui/CompareScreen.tsx e2e/render.spec.ts
git commit -m "feat: bandeau date/heure et disposition forcée pour l'image côte-à-côte"
```

---

### Task 4: Extraire le dessin de transition partagé

Refactoring **sans changement de comportement** : `gif.ts` et `video.ts` dupliquent le même bloc « dessine l'avant, puis l'après en alpha ». On l'extrait avant d'ajouter des transitions, plutôt que d'en écrire une troisième copie.

**Files:**
- Create: `src/render/crossfade.ts`
- Test: `src/render/crossfade.test.ts`
- Modify: `src/render/gif.ts`
- Modify: `src/render/video.ts`

**Interfaces:**
- Consumes: `Transition` de `@/lib/exportOptions` (Task 1), `drawShot` de `./drawShot`.
- Produces: le type `ScaledInput = { source: Drawable; transform: Transform; shot: Size }` ; `scaleInput(input: ComparisonInput, factor: number): ScaledInput` ; `drawTransition(ctx, from, to, size, mix, transition): void` ; `transitionSteps(transition: Transition): number`. Consommés par les Tasks 5, 6 et 7.

- [ ] **Step 1: Write the failing test**

Créer `src/render/crossfade.test.ts` :

```ts
import { describe, expect, it } from 'vitest'
import { IDENTITY } from '@/align/transform'
import { scaleInput, transitionSteps } from './crossfade'

describe('transitionSteps', () => {
  it('garde le rythme du fondu actuel', () => {
    // GIF_STEPS (10) frames dont deux sont les paliers immobiles : il reste 8 frames
    // de transition. Changer ce nombre changerait la durée de tous les exports.
    expect(transitionSteps('crossfade')).toBe(8)
  })

  it('donne au balayage le même rythme qu au fondu', () => {
    expect(transitionSteps('wipe')).toBe(8)
  })

  it('ne dépense aucune frame pour une coupe franche', () => {
    // Une coupe n a pas d états intermédiaires : les frames qui les figureraient
    // seraient du poids de fichier pour rien.
    expect(transitionSteps('cut')).toBe(0)
  })
})

describe('scaleInput', () => {
  it('met la translation et les dimensions à l échelle, pas la source', () => {
    const source = {} as never
    const input = {
      source,
      transform: { ...IDENTITY, tx: 100, ty: -40 },
      takenAt: 123,
      shot: { width: 1200, height: 1600 },
    }

    const scaled = scaleInput(input, 0.5)

    expect(scaled.transform).toEqual({ ...IDENTITY, tx: 50, ty: -20 })
    expect(scaled.shot).toEqual({ width: 600, height: 800 })
    expect(scaled.source).toBe(source)
    // `takenAt` ne sert qu au bandeau de l image côte-à-côte : il n a rien à faire
    // dans une entrée de rendu animé.
    expect(scaled).not.toHaveProperty('takenAt')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/render/crossfade.test.ts`
Expected: FAIL — `Failed to resolve import "./crossfade"`.

- [ ] **Step 3: Write minimal implementation**

Créer `src/render/crossfade.ts` :

```ts
import type { Transition } from '@/lib/exportOptions'
import type { Size, Transform } from '@/types'
import { drawShot, type Drawable } from './drawShot'
import { GIF_STEPS } from './gif'
import type { ComparisonInput } from './sideBySide'

/** Une entrée de comparaison ramenée à l échelle d export, sans sa date. */
export type ScaledInput = {
  source: Drawable
  transform: Transform
  shot: Size
}

/**
 * Ramène une entrée à l échelle d export. La transformation stockée est en pixels du
 * cadre canonique : sa translation suit le facteur, son `scale` est déjà relatif.
 */
export function scaleInput(input: ComparisonInput, factor: number): ScaledInput {
  return {
    source: input.source,
    transform: {
      ...input.transform,
      tx: input.transform.tx * factor,
      ty: input.transform.ty * factor,
    },
    shot: {
      width: input.shot.width * factor,
      height: input.shot.height * factor,
    },
  }
}

/**
 * Nombre de frames intermédiaires entre les deux paliers immobiles.
 *
 * Le fondu du GIF compte `GIF_STEPS` frames dont deux sont les paliers : il reste
 * `GIF_STEPS - 2` frames de transition. Une coupe franche n en a aucune.
 */
export function transitionSteps(transition: Transition): number {
  return transition === 'cut' ? 0 : GIF_STEPS - 2
}

/**
 * Dessine l état intermédiaire `mix` (0 = avant, 1 = après) selon la transition
 * demandée. Seul endroit du code où une transition est définie : `gif.ts` et
 * `video.ts` s en servent tous les deux, et se comportent donc pareil.
 */
export function drawTransition(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  from: ScaledInput,
  to: ScaledInput,
  size: Size,
  mix: number,
  transition: Transition,
): void {
  ctx.clearRect(0, 0, size.width, size.height)
  ctx.globalAlpha = 1

  if (transition === 'cut') {
    // Aucun état intermédiaire à représenter : on bascule à mi-course.
    const shown = mix < 0.5 ? from : to
    drawShot(ctx, shown.source, shown.transform, size, shown.shot)
    return
  }

  drawShot(ctx, from.source, from.transform, size, from.shot)
  if (mix <= 0) return

  if (transition === 'wipe') {
    // Une ligne qui balaie l image, comme le curseur de révélation. Au retour, `mix`
    // redescend de 1 à 0 : le balayage repart de lui-même en sens inverse.
    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, size.width * mix, size.height)
    ctx.clip()
    drawShot(ctx, to.source, to.transform, size, to.shot)
    ctx.restore()
    return
  }

  ctx.globalAlpha = mix
  drawShot(ctx, to.source, to.transform, size, to.shot)
  ctx.globalAlpha = 1
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/render/crossfade.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: Faire consommer `crossfade.ts` par `gif.ts`, sans changer son comportement**

Dans `src/render/gif.ts` : ajouter `import { drawTransition, scaleInput } from './crossfade'`, supprimer l'import de `drawShot` (devenu inutile) et le helper local `scaled`, puis remplacer le corps de la boucle de rasterisation.

Remplacer :

```ts
  const scaled = (input: ComparisonInput) => ({ /* … */ })

  const from = scaled(before)
  const to = scaled(after)
```

par :

```ts
  const from = scaleInput(before, widthFactor)
  const to = scaleInput(after, widthFactor)
```

et remplacer, dans la boucle :

```ts
    const mix = step / (GIF_STEPS - 1)
    ctx.clearRect(0, 0, width, height)
    ctx.globalAlpha = 1
    drawShot(ctx, from.source, from.transform, { width, height }, from.shot)
    if (mix > 0) {
      ctx.globalAlpha = mix
      drawShot(ctx, to.source, to.transform, { width, height }, to.shot)
      ctx.globalAlpha = 1
    }
```

par :

```ts
    const mix = step / (GIF_STEPS - 1)
    drawTransition(ctx, from, to, { width, height }, mix, 'crossfade')
```

`crossfade.ts` importe `GIF_STEPS` depuis `gif.ts`, et `gif.ts` importe deux fonctions de `crossfade.ts`. Ce cycle d'imports est sans danger — aucun des deux modules ne lit la valeur de l'autre pendant son évaluation — mais si le bundler s'en plaint, déplacer les quatre constantes `GIF_*` de `gif.ts` vers `crossfade.ts` et les y réexporter depuis `gif.ts`.

- [ ] **Step 6: Faire consommer `crossfade.ts` par `video.ts`, sans changer son comportement**

Dans `src/render/video.ts` : ajouter `import { drawTransition, scaleInput, transitionSteps } from './crossfade'`, supprimer l'import de `drawShot`, le helper local `scaled`, la fonction locale `draw` et la constante `FADE_STEPS`.

Remplacer :

```ts
const FADE_STEPS = GIF_STEPS - 2
```

par rien, et à l'intérieur de `renderCrossfadeVideo` :

```ts
  const from = scaleInput(before, widthFactor)
  const to = scaleInput(after, widthFactor)
  const fadeSteps = transitionSteps('crossfade')
```

Remplacer la fonction locale `draw(mix)` par des appels directs à
`drawTransition(ctx, from, to, { width, height }, mix, 'crossfade')`, et les trois
occurrences de `FADE_STEPS` par `fadeSteps`. L'import de `GIF_STEPS` disparaît de la
ligne d'import de `./gif`, qui garde `GIF_HOLD_MS`, `GIF_MAX_WIDTH` et `GIF_STEP_MS`.

- [ ] **Step 7: Vérifier qu'aucun comportement n'a bougé**

Run: `npx tsc -b && npm test && npx playwright test e2e/render.spec.ts`
Expected: PASS — toute la suite de rendu existante, inchangée. C'est le contrat de cette tâche : aucun test n'a été modifié, donc aucun rendu n'a bougé.

- [ ] **Step 8: Commit**

```bash
git add src/render/crossfade.ts src/render/crossfade.test.ts src/render/gif.ts src/render/video.ts
git commit -m "refactor: extrait le dessin de transition partagé par le GIF et la vidéo"
```

---

### Task 5: Transitions coupe franche et balayage

**Files:**
- Modify: `src/render/gif.ts`
- Modify: `src/render/video.ts`
- Test: `e2e/render.spec.ts`

**Interfaces:**
- Consumes: `drawTransition`, `transitionSteps` de `./crossfade` (Task 4) ; `Transition` de `@/lib/exportOptions`.
- Produces: `renderCrossfadeGif(before, after, frame, options?: { transition?: Transition; onProgress?; signal? })` et `renderCrossfadeVideo(before, after, frame, options?: { transition?: Transition; onProgress?; signal? })`. Le défaut de `transition` est `'crossfade'`, donc tous les appels existants restent valides.

- [ ] **Step 1: Write the failing test**

Ajouter à `e2e/render.spec.ts` :

```ts
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
      transition: 'cut',
      onProgress: (done, total) => progress.push([done, total]),
    })

    return { type: blob.type, size: blob.size, progress }
  }, HELPERS)

  expect(result.type.startsWith('video/mp4')).toBe(true)
  expect(result.size).toBeGreaterThan(1000)
  // 3 allers-retours x 1 palier, aucune frame de transition.
  expect(result.progress.at(-1)).toEqual([3, 3])
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test e2e/render.spec.ts -g "coupe franche|balaie"`
Expected: FAIL — l'option `transition` est ignorée : le GIF en coupe rend `[10, 10]` au lieu de `[2, 2]`, et le balayage à mi-course donne un mélange violet des deux côtés.

- [ ] **Step 3: Write minimal implementation — `gif.ts`**

Dans `src/render/gif.ts`, remplacer la signature et la boucle de `renderCrossfadeGif` :

```ts
export async function renderCrossfadeGif(
  before: ComparisonInput,
  after: ComparisonInput,
  frame: Size,
  options: {
    transition?: Transition
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
  } = {},
): Promise<Blob> {
  if (options.signal?.aborted) throw abortError()

  const transition = options.transition ?? 'crossfade'
  // Deux paliers immobiles, plus les frames de transition : une coupe franche n en a
  // aucune et se réduit donc à deux frames.
  const steps = transitionSteps(transition) + 2
  /* … calcul de width/height inchangé, `from` / `to` inchangés … */

  for (let step = 0; step < steps; step += 1) {
    if (options.signal?.aborted) throw abortError()

    const mix = step / (steps - 1)
    drawTransition(ctx, from, to, { width, height }, mix, transition)

    frames.push(ctx.getImageData(0, 0, width, height).data.buffer as ArrayBuffer)
    const isEdge = step === 0 || step === steps - 1
    delays.push(isEdge ? GIF_HOLD_MS : GIF_STEP_MS)
  }
```

Ajouter `import type { Transition } from '@/lib/exportOptions'` et `transitionSteps` à l'import de `./crossfade`. `GIF_STEPS` reste exporté — `crossfade.ts` s'en sert.

- [ ] **Step 4: Write minimal implementation — `video.ts`**

Dans `src/render/video.ts`, ajouter `transition` aux options, et remplacer les deux
usages :

```ts
  options: {
    transition?: Transition
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
  } = {},
```

```ts
  const transition = options.transition ?? 'crossfade'
  const fadeSteps = transitionSteps(transition)
```

Le `total` suit : `const total = REPS * (1 + fadeSteps)`. La boucle de fondu
(`for (let step = 1; step <= fadeSteps; …)`) ne tourne plus du tout quand `fadeSteps`
vaut 0, et l'appel de palier `drawTransition(ctx, from, to, …, mix, transition)` suffit
alors à jouer la bascule — c'est bien ce qu'on veut d'une coupe. Ajouter
`import type { Transition } from '@/lib/exportOptions'`.

Attention : avec `fadeSteps` à 0, `mix` doit tout de même alterner entre 0 et 1 d'un
aller à l'autre. La ligne `mix = target` en fin de boucle s'en charge déjà, `target`
valant `1 - mix` — aucune modification nécessaire, mais le vérifier avant de conclure.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsc -b && npx playwright test e2e/render.spec.ts`
Expected: PASS — les nouveaux tests plus tous les anciens, qui n'ont pas été modifiés et exercent donc le défaut `'crossfade'`.

- [ ] **Step 6: Commit**

```bash
git add src/render/gif.ts src/render/video.ts e2e/render.spec.ts
git commit -m "feat: transitions coupe franche et balayage pour les exports animés"
```

---

### Task 6: Largeur d'export réglable

**Files:**
- Modify: `src/render/gif.ts`
- Modify: `src/render/video.ts`
- Test: `e2e/render.spec.ts`

**Interfaces:**
- Consumes: `VideoWidth` de `@/lib/exportOptions` (Task 1), `EXPORT_MAX_EDGE` de `./sideBySide`.
- Produces: `targetWidth(width: VideoWidth, frame: Size): number` exporté par `src/render/crossfade.ts` ; l'option `width?: VideoWidth` sur `renderCrossfadeGif` et `renderCrossfadeVideo`, de défaut `640`.

- [ ] **Step 1: Write the failing test**

Ajouter à `src/render/crossfade.test.ts` (et compléter la ligne d'import) :

```ts
describe('targetWidth', () => {
  it('rend la largeur demandée', () => {
    expect(targetWidth(640, { width: 1200, height: 1600 })).toBe(640)
    expect(targetWidth(1080, { width: 1200, height: 1600 })).toBe(1080)
  })

  it('rend la largeur du cadre en pleine résolution', () => {
    expect(targetWidth('full', { width: 1200, height: 1600 })).toBe(1200)
  })

  it('plafonne la pleine résolution à EXPORT_MAX_EDGE', () => {
    // Un cadre de 4000 px n a pas à produire une vidéo de 4000 px de large : le
    // plafond est le même que celui de l export JPEG.
    expect(targetWidth('full', { width: 4000, height: 3000 })).toBe(2048)
  })
})
```

Ajouter à `e2e/render.spec.ts` :

```ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/render/crossfade.test.ts` puis `npx playwright test e2e/render.spec.ts -g "1080|agrandit jamais un cadre"`
Expected: FAIL — `targetWidth is not a function`, et le GIF rend 640 px au lieu de 1080.

- [ ] **Step 3: Write minimal implementation**

Dans `src/render/crossfade.ts`, **compléter les imports existants** plutôt que d'en
ajouter de nouveaux depuis les mêmes modules — oxlint signale les imports en double :

- `import type { Transition } from '@/lib/exportOptions'` devient
  `import type { Transition, VideoWidth } from '@/lib/exportOptions'`
- `import type { ComparisonInput } from './sideBySide'` se dédouble en une ligne de type
  et une ligne de valeur, `import { EXPORT_MAX_EDGE } from './sideBySide'`, puisque
  `EXPORT_MAX_EDGE` est une valeur et non un type.

Puis ajouter :

```ts
/**
 * Largeur cible en pixels pour un export animé. `'full'` prend la largeur du cadre,
 * plafonnée au même maximum que l export JPEG : un cadre de 4000 px n a pas à
 * produire une vidéo de 4000 px de large.
 */
export function targetWidth(width: VideoWidth, frame: Size): number {
  return width === 'full' ? Math.min(frame.width, EXPORT_MAX_EDGE) : width
}
```

Dans `src/render/gif.ts` et `src/render/video.ts`, ajouter `width?: VideoWidth` aux options et remplacer le calcul du facteur :

```ts
  // Le plafond n est jamais franchi vers le haut : un export n agrandit pas.
  const widthFactor = Math.min(1, targetWidth(options.width ?? 640, frame) / frame.width)
```

La constante `GIF_MAX_WIDTH` devient le défaut du réglage plutôt qu'un plafond en dur.
La garder exportée — `video.ts` la réexporte sous `VIDEO_MAX_WIDTH` — et remplacer le
littéral `640` ci-dessus par `GIF_MAX_WIDTH` dans `gif.ts`, `VIDEO_MAX_WIDTH` dans
`video.ts`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsc -b && npm test && npx playwright test e2e/render.spec.ts`
Expected: PASS — dont les deux tests historiques « réduit la largeur à 640 px », qui n'ont pas été modifiés et vérifient donc que le défaut n'a pas bougé.

- [ ] **Step 5: Commit**

```bash
git add src/render/crossfade.ts src/render/crossfade.test.ts src/render/gif.ts src/render/video.ts e2e/render.spec.ts
git commit -m "feat: largeur d'export réglable pour les exports animés"
```

---

### Task 7: Durée de la vidéo réglable

**Files:**
- Modify: `src/render/video.ts`
- Test: `e2e/render.spec.ts`

**Interfaces:**
- Consumes: `VideoLength` de `@/lib/exportOptions` (Task 1).
- Produces: l'option `reps?: VideoLength` sur `renderCrossfadeVideo`, de défaut `3`. **Pas** sur `renderCrossfadeGif` : un GIF boucle à l'infini, des allers-retours en plus n'ajouteraient que du poids.

- [ ] **Step 1: Write the failing test**

Ajouter à `e2e/render.spec.ts` :

```ts
test('renderCrossfadeVideo joue le nombre d allers-retours demandé', async ({ page }) => {
  const progress = await page.evaluate(async (helpers) => {
    eval(helpers)
    const { renderCrossfadeVideo } = await import('/src/render/video.ts')
    const { IDENTITY } = await import('/src/align/transform.ts')

    const frame = { width: 100, height: 150 }
    const bitmap = window.__stripes(100, 150)
    const input = { source: bitmap, transform: IDENTITY, takenAt: 0, shot: frame }

    const seen = []
    // `transition: 'cut'` pour que le test reste court : un palier par aller-retour,
    // aucune frame de fondu. Ce qu on mesure ici, c est le nombre d allers-retours.
    await renderCrossfadeVideo(input, input, frame, {
      reps: 1,
      transition: 'cut',
      onProgress: (done, total) => seen.push([done, total]),
    })
    return seen
  }, HELPERS)

  expect(progress.at(-1)).toEqual([1, 1])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/render.spec.ts -g "allers-retours demandé"`
Expected: FAIL — `[3, 3]` au lieu de `[1, 1]` : `reps` est ignoré.

- [ ] **Step 3: Write minimal implementation**

Dans `src/render/video.ts` :

- supprimer la constante `REPS` et son commentaire de tête, en déplaçant l'explication dans la documentation de l'option ;
- ajouter `reps?: VideoLength` aux options ;
- `const reps = options.reps ?? 3` ;
- remplacer les deux usages de `REPS` par `reps` (`const total = reps * (1 + fadeSteps)` et `for (let rep = 0; rep < reps; rep += 1)`).

Documenter le défaut là où il est lu :

```ts
  // Trois allers-retours par défaut, soit environ 3,4 s : un seul aller ne dure que
  // le temps d une prise plus un fondu (~1,1 s) et se lit comme un instantané figé
  // plutôt que comme une animation.
  const reps = options.reps ?? 3
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx tsc -b && npx playwright test e2e/render.spec.ts -g renderCrossfadeVideo`
Expected: PASS — dont les tests existants, qui n'ont pas été modifiés et vérifient donc le défaut de 3.

- [ ] **Step 5: Commit**

```bash
git add src/render/video.ts e2e/render.spec.ts
git commit -m "feat: durée réglable pour l'export vidéo"
```

---

### Task 8: Pied de page fixe et image à la hauteur disponible

**Files:**
- Modify: `src/ui/components/Screen.tsx`
- Modify: `src/ui/components/RevealSlider.tsx`
- Modify: `src/ui/CompareScreen.tsx`
- Test: `e2e/flow.spec.ts`

**Interfaces:**
- Consumes: rien de nouveau.
- Produces: la prop `footer?: ReactNode` de `Screen`, rendue **hors** du conteneur défilant. Consommée par la Task 10 et par la page À propos si elle en a besoin.

- [ ] **Step 1: Write the failing test**

Ajouter à `e2e/flow.spec.ts`, à côté des tests d'export :

```ts
test('la comparaison ne défile pas sur un écran de téléphone', async ({ page }) => {
  // Écran de téléphone : c est là que le problème se posait, l image y prenant
  // presque toute la hauteur utile.
  await page.setViewportSize({ width: 390, height: 664 })

  const { viewpointId, before, after } = await seedPair(page)
  await page.goto(`/v/${viewpointId}/compare?before=${before}&after=${after}`)
  await expect(page.getByTestId('reveal-slider')).toBeVisible()

  // L image se contente de la hauteur restante : il n y a rien à défiler.
  const overflow = await page.evaluate(() => {
    const main = document.querySelector('main')
    if (!main) throw new Error('main introuvable')
    return main.scrollHeight - main.clientHeight
  })
  expect(overflow).toBeLessThanOrEqual(1)
})
```

Ce test porte sur le dimensionnement seul, ce que cette tâche livre. L'assertion
complémentaire — les deux boutons de la barre visibles sans défiler — rejoint ce test en
Task 10, quand ces boutons existent. Cette tâche se termine donc avec **toute la suite
au vert**, pas avec un test rouge en attente.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/flow.spec.ts -g "sans défiler"`
Expected: FAIL — `open-image-options` n'existe pas encore.

- [ ] **Step 3: Ajouter la prop `footer` à `Screen`**

Remplacer `src/ui/components/Screen.tsx` par :

```tsx
import type { ReactNode } from 'react'

export function Screen({
  title,
  back,
  action,
  footer,
  children,
}: {
  title: string
  back?: ReactNode
  action?: ReactNode
  /**
   * Barre de commandes rendue sous le contenu. Elle est **hors** du conteneur
   * défilant, donc fixe par construction : ni `position: fixed`, ni `z-index`, ni
   * hauteur à compenser dans le contenu.
   */
  footer?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-slate-700 px-4 py-3">
        {back}
        <h1 className="flex-1 truncate text-lg font-semibold">{title}</h1>
        {action}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto">{children}</main>
      {footer && (
        <div className="border-t border-slate-700 pb-[env(safe-area-inset-bottom)]">
          {footer}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Faire remplir sa boîte au `RevealSlider`**

Dans `src/ui/components/RevealSlider.tsx`, ajouter `h-full w-full` à la liste de classes du conteneur racine :

```tsx
      className="relative h-full w-full touch-none overflow-hidden rounded-xl bg-black"
```

- [ ] **Step 5: Faire tenir l'image dans la hauteur disponible**

Dans `src/ui/CompareScreen.tsx` :

- le conteneur du corps passe de `space-y-4 p-4` à `flex h-full flex-col gap-4 p-4` ;
- la boîte `aspectRatio` autour du `RevealSlider` **disparaît** ;
- les deux `ShotCanvas` passent de `className="h-full w-full"` à `className="h-full w-full object-contain"`.

Le fragment devient :

```tsx
        {pair && frame && (
          <>
            <div className="flex min-h-0 flex-1">
              <RevealSlider
                before={
                  <ShotCanvas
                    source={beforeBitmap}
                    transform={pair.before.transform}
                    frame={frame}
                    shot={{ width: pair.before.width, height: pair.before.height }}
                    className="h-full w-full object-contain"
                  />
                }
                after={
                  <ShotCanvas
                    source={afterBitmap}
                    transform={pair.after.transform}
                    frame={frame}
                    shot={{ width: pair.after.width, height: pair.after.height }}
                    className="h-full w-full object-contain"
                  />
                }
              />
            </div>
```

Une boîte `aspect-ratio` bornée à la fois en largeur et en hauteur se déforme dès
qu'une des deux bornes mord : le ratio n'est préservé que si une seule dimension est
définie. `object-contain` sur un canvas — élément remplacé, de ratio intrinsèque connu
grâce à ses attributs `width` / `height` — ne peut structurellement pas déformer. Les
deux canvas étant contenus à l'identique, la couture du curseur tombe au même `x` dans
les deux ; seule la poignée blanche court dans les bandes noires, ce que le `bg-black`
du `RevealSlider` rend volontaire.

- [ ] **Step 6: Vérifier de visu**

Lancer `npm run dev`, ouvrir une comparaison dans un viewport de 390 × 664, et vérifier
que l'image n'est **pas déformée** (un cadre portrait doit rester portrait), qu'elle
tient entièrement à l'écran, et que la poignée de révélation suit toujours le doigt.
Aucune assertion automatique ne remplace ce coup d'œil sur la déformation.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx tsc -b && npx playwright test e2e/flow.spec.ts`
Expected: PASS — dont le nouveau test « ne défile pas sur un écran de téléphone ». Les
exports continuent de fonctionner : cette tâche n'a pas encore touché aux boutons, qui
sont toujours dans le corps de l'écran.

- [ ] **Step 8: Commit**

```bash
git add src/ui/components/Screen.tsx src/ui/components/RevealSlider.tsx src/ui/CompareScreen.tsx e2e/flow.spec.ts
git commit -m "feat: pied de page fixe sur Screen et image à la hauteur disponible"
```

---

### Task 9: Feuille modale, icônes et ligne de réglage

Trois composants de présentation, sans logique métier, livrés ensemble parce
qu'aucun n'est observable seul : ils n'ont de test qu'à travers l'écran qui les
monte, en Task 10.

**Files:**
- Create: `src/ui/components/Sheet.tsx`
- Create: `src/ui/components/icons.tsx`
- Create: `src/ui/components/OptionRow.tsx`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `Sheet({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: ReactNode })`
  - `SideBySideIcon()` et `PlayIcon()`, deux composants sans props rendant un `<svg>` de 24 px en `currentColor`
  - `OptionRow<T>({ label, value, options, onChange, testId }: { label: string; value: T; options: readonly { value: T; label: string }[]; onChange: (value: T) => void; testId?: string })`

- [ ] **Step 1: Écrire `Sheet.tsx`**

```tsx
import { useEffect, type ReactNode } from 'react'

/**
 * Feuille modale ancrée en bas de l écran. Générique et sans logique métier : elle ne
 * sait rien des réglages qu on lui confie.
 */
export function Sheet({
  title,
  open,
  onClose,
  children,
}: {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-10 flex flex-col justify-end">
      {/* Le voile ferme la feuille, et absorbe les tapes qui la manquent : sans lui,
          une tape à côté atteindrait le curseur de révélation sous la feuille. */}
      <button
        type="button"
        aria-label="Fermer"
        onClick={onClose}
        className="flex-1 bg-slate-950/70"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85%] overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-900 pb-[env(safe-area-inset-bottom)]"
      >
        <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <h2 className="flex-1 font-semibold text-slate-100">{title}</h2>
          <button
            type="button"
            data-testid="close-sheet"
            onClick={onClose}
            aria-label="Fermer"
            className="px-2 text-lg text-slate-300"
          >
            ✕
          </button>
        </header>
        <div className="space-y-5 p-4">{children}</div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Écrire `icons.tsx`**

```tsx
/**
 * Icônes en SVG inline. Une bibliothèque d icônes pour deux glyphes alourdirait le
 * paquet d une PWA dont l installation hors ligne est un objectif.
 */
const COMMON = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/** Deux cadres accolés : l image côte-à-côte. */
export function SideBySideIcon() {
  return (
    <svg {...COMMON}>
      <rect x="2.5" y="5" width="8" height="14" rx="1.5" />
      <rect x="13.5" y="5" width="8" height="14" rx="1.5" />
    </svg>
  )
}

/** Un triangle de lecture dans un cadre : l export animé. */
export function PlayIcon() {
  return (
    <svg {...COMMON}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="M10 9.5l5 2.5-5 2.5z" />
    </svg>
  )
}
```

- [ ] **Step 3: Écrire `OptionRow.tsx`**

```tsx
/**
 * Une ligne de réglage : un libellé et un groupe de boutons à choix unique. Six
 * usages entre les deux feuilles — le factoriser évite six copies du même balisage,
 * et garantit que les six se comportent pareil.
 */
export function OptionRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  testId?: string
}) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <p className="text-sm text-slate-300">{label}</p>
      {/* `radiogroup` plutôt que des <input type="radio"> : le rendu attendu est un
          segmenté, et les rôles ARIA le décrivent sans lutter contre le style natif. */}
      <div role="radiogroup" aria-label={label} className="flex gap-2">
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              data-value={option.value}
              onClick={() => onChange(option.value)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                selected
                  ? 'border-sky-400 bg-sky-500/15 text-sky-100'
                  : 'border-slate-600 text-slate-300'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Vérifier la compilation**

Run: `npx tsc -b && npm run lint`
Expected: PASS. Aucun test de comportement à cette étape — ces trois composants ne sont observables qu'à travers l'écran qui les monte, en Task 10.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/Sheet.tsx src/ui/components/icons.tsx src/ui/components/OptionRow.tsx
git commit -m "feat: feuille modale, icônes d'export et ligne de réglage"
```

---

### Task 10: Câbler la barre du bas et les deux feuilles

**Files:**
- Create: `src/hooks/useExportOptions.ts`
- Modify: `src/ui/CompareScreen.tsx`
- Test: `e2e/flow.spec.ts`

**Interfaces:**
- Consumes: tout ce qui précède — `loadExportOptions` / `saveExportOptions` / les listes de valeurs (Task 1), `renderSideBySide` (Task 3), `renderCrossfadeGif` / `renderCrossfadeVideo` (Tasks 5–7), la prop `footer` (Task 8), `Sheet` / `OptionRow` / les icônes (Task 9).
- Produces: `useExportOptions(): [ExportOptions, (patch: DeepPartialExportOptions) => void]`. Les `data-testid` `open-image-options`, `open-video-options`, `stamp-mode`, `layout-mode`, `transition-mode`, `video-width`, `video-length`.

- [ ] **Step 1: Write the failing test**

Ajouter à `e2e/flow.spec.ts` :

```ts
test('mémorise les réglages d export d une visite à l autre', async ({ page }) => {
  const { viewpointId, before, after } = await seedPair(page)
  const url = `/v/${viewpointId}/compare?before=${before}&after=${after}`
  await page.goto(url)

  await page.getByTestId('open-image-options').click()
  await page.getByTestId('stamp-mode').getByRole('radio', { name: 'Date + heure' }).click()
  await page.getByTestId('layout-mode').getByRole('radio', { name: 'Vertical' }).click()
  await page.getByTestId('close-sheet').click()

  // Rechargement complet : ce qui survit vient de localStorage, pas de l état React.
  await page.goto(url)
  await page.getByTestId('open-image-options').click()

  await expect(
    page.getByTestId('stamp-mode').getByRole('radio', { name: 'Date + heure' }),
  ).toHaveAttribute('aria-checked', 'true')
  await expect(
    page.getByTestId('layout-mode').getByRole('radio', { name: 'Vertical' }),
  ).toHaveAttribute('aria-checked', 'true')
})
```

Compléter aussi le test « ne défile pas sur un écran de téléphone » de la Task 8 : les
boutons de la barre existent désormais, donc l'assertion qui manquait a lieu d'être.
Ajouter, juste après le `await expect(page.getByTestId('reveal-slider')).toBeVisible()` :

```ts
  // Le motif du problème d origine : les commandes d export sont atteignables sans
  // le moindre geste de défilement.
  await expect(page.getByTestId('open-image-options')).toBeInViewport()
  await expect(page.getByTestId('open-video-options')).toBeInViewport()
```

Et modifier les quatre exports existants pour ouvrir la feuille d'abord :

- test « exporte une image côte-à-côte » : insérer `await page.getByTestId('open-image-options').click()` avant `page.getByTestId('export-jpeg').click()`
- test « exporte une vidéo animée avec une progression » : insérer `await page.getByTestId('open-video-options').click()` avant `export-gif`
- test « replie sur le GIF… » : idem
- test « parcours complet… » : insérer `await page.getByTestId('open-image-options').click()` avant `export-jpeg`

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx playwright test e2e/flow.spec.ts`
Expected: FAIL — `open-image-options` introuvable, sur les cinq tests.

- [ ] **Step 3: Écrire le hook**

Créer `src/hooks/useExportOptions.ts` :

```ts
import { useCallback, useState } from 'react'
import {
  loadExportOptions,
  saveExportOptions,
  type ExportOptions,
  type ImageOptions,
  type VideoOptions,
} from '@/lib/exportOptions'

export type ExportOptionsPatch = {
  image?: Partial<ImageOptions>
  video?: Partial<VideoOptions>
}

/**
 * Options d export mémorisées. Le patch est fusionné champ par champ dans la section
 * visée : une feuille ne peut donc pas effacer un réglage qu elle n affiche pas.
 */
export function useExportOptions(): [ExportOptions, (patch: ExportOptionsPatch) => void] {
  // Initialiseur paresseux : la lecture de `localStorage` ne doit avoir lieu qu au
  // montage, pas à chaque rendu.
  const [options, setOptions] = useState<ExportOptions>(loadExportOptions)

  const update = useCallback((patch: ExportOptionsPatch) => {
    setOptions((current) => {
      const next: ExportOptions = {
        image: { ...current.image, ...patch.image },
        video: { ...current.video, ...patch.video },
      }
      saveExportOptions(next)
      return next
    })
  }, [])

  return [options, update]
}
```

- [ ] **Step 4: Réécrire `CompareScreen`**

`src/ui/CompareScreen.tsx` en entier :

```tsx
import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { getShot } from '@/db/shots'
import { getViewpoint } from '@/db/viewpoints'
import { useBitmap } from '@/hooks/useBitmap'
import { useExportOptions } from '@/hooks/useExportOptions'
import { formatDate } from '@/lib/format'
import type { Layout, StampMode, Transition, VideoLength, VideoWidth } from '@/lib/exportOptions'
import { renderCrossfadeGif } from '@/render/gif'
import { renderSideBySide, type ComparisonInput } from '@/render/sideBySide'
import { renderCrossfadeVideo, supportedVideoMime } from '@/render/video'
import { shareOrDownload } from '@/share/shareOrDownload'
import type { Shot, Size, Viewpoint } from '@/types'
import { OptionRow } from './components/OptionRow'
import { RevealSlider } from './components/RevealSlider'
import { Screen } from './components/Screen'
import { Sheet } from './components/Sheet'
import { ShotCanvas } from './components/ShotCanvas'
import { PlayIcon, SideBySideIcon } from './components/icons'

const STAMP_LABELS: readonly { value: StampMode; label: string }[] = [
  { value: 'none', label: 'Aucun' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date + heure' },
]

const LAYOUT_LABELS: readonly { value: Layout; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
]

const TRANSITION_LABELS: readonly { value: Transition; label: string }[] = [
  { value: 'crossfade', label: 'Fondu' },
  { value: 'cut', label: 'Coupe' },
  { value: 'wipe', label: 'Balayage' },
]

const WIDTH_LABELS: readonly { value: VideoWidth; label: string }[] = [
  { value: 640, label: 'Standard' },
  { value: 1080, label: 'Haute' },
  { value: 'full', label: 'Maximale' },
]

const LENGTH_LABELS: readonly { value: VideoLength; label: string }[] = [
  { value: 1, label: 'Court' },
  { value: 3, label: 'Moyen' },
  { value: 5, label: 'Long' },
]

// ⚠️ NE PAS RETAPER `slugify` NI `fileStamp`. Les deux fonctions du fichier actuel
// sont conservées **à l identique**, à leur place actuelle, au-dessus de
// `CompareScreen`. La classe de caractères de `slugify` contient des échappements
// unicode (plage des diacritiques combinants) qu une recopie à la main casse
// silencieusement : le nom de fichier cesserait alors de perdre ses accents.
// Reprendre les lignes existantes telles quelles.

export function CompareScreen() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()

  const [viewpoint, setViewpoint] = useState<Viewpoint | null>(null)
  const [pair, setPair] = useState<{ before: Shot; after: Shot } | null>(null)
  const [status, setStatus] = useState<string | null>('Chargement…')
  const [options, updateOptions] = useExportOptions()
  const [sheet, setSheet] = useState<null | 'image' | 'video'>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState<null | 'jpeg' | 'anim'>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Annuler l encodage si l utilisateur quitte l écran : sans ça le worker
  // continuerait de tourner pour un fichier que plus personne n attend.
  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (!id) return
    const beforeId = params.get('before')
    const afterId = params.get('after')

    Promise.all([
      getViewpoint(id),
      beforeId ? getShot(beforeId) : undefined,
      afterId ? getShot(afterId) : undefined,
    ]).then(([foundViewpoint, before, after]) => {
      if (!foundViewpoint || !before || !after) {
        setStatus('Comparaison introuvable. Retournez à la série pour en choisir une autre.')
        return
      }
      setViewpoint(foundViewpoint)
      setPair({ before, after })
      setStatus(null)
    }).catch(() => setStatus('Impossible de lire cette comparaison.'))
  }, [id, params])

  const { bitmap: beforeBitmap, error: beforeBitmapError } = useBitmap(pair?.before.blob)
  const { bitmap: afterBitmap, error: afterBitmapError } = useBitmap(pair?.after.blob)
  const bitmapError = beforeBitmapError || afterBitmapError

  const frame: Size | null = viewpoint
    ? { width: viewpoint.frameWidth, height: viewpoint.frameHeight }
    : null

  // Les boutons d export restent inertes tant que les deux photos ne sont pas
  // décodées : les activer plus tôt donnerait une tape sans effet ni message.
  const ready = Boolean(pair && frame && beforeBitmap && afterBitmap)

  // Choisi une fois pour l écran : sert à masquer le réglage de durée, qui ne
  // s applique pas au repli GIF.
  const videoSupported = supportedVideoMime() !== null

  function inputsFor(): { before: ComparisonInput; after: ComparisonInput } | null {
    if (!pair || !beforeBitmap || !afterBitmap) return null
    return {
      before: {
        source: beforeBitmap,
        transform: pair.before.transform,
        takenAt: pair.before.takenAt,
        shot: { width: pair.before.width, height: pair.before.height },
      },
      after: {
        source: afterBitmap,
        transform: pair.after.transform,
        takenAt: pair.after.takenAt,
        shot: { width: pair.after.width, height: pair.after.height },
      },
    }
  }

  async function exportJpeg() {
    const inputs = inputsFor()
    // `busy` verrouille les deux boutons : sans lui, une double tape ou une tape sur
    // l autre export lancerait un second travail concurrent, donc deux partages.
    if (!inputs || !frame || !viewpoint || !pair || busy) return
    setBusy('jpeg')
    setStatus("Génération de l'image…")
    try {
      const blob = await renderSideBySide(inputs.before, inputs.after, frame, options.image)
      const name = `b4after-${slugify(viewpoint.name)}-${fileStamp(pair.after.takenAt)}.jpg`
      const outcome = await shareOrDownload(new File([blob], name, { type: 'image/jpeg' }))
      setSheet(null)
      setStatus(outcome === 'downloaded' ? 'Image téléchargée.' : null)
    } catch {
      setStatus("La génération de l'image a échoué.")
    } finally {
      setBusy(null)
    }
  }

  async function exportAnimation() {
    const inputs = inputsFor()
    if (!inputs || !frame || !viewpoint || !pair || busy) return
    const controller = new AbortController()
    abortRef.current = controller
    // Choisi une seule fois par export : MediaRecorder ne change pas de format en
    // cours de route, et refaire l appel à mi-parcours ne servirait à rien.
    const mime = supportedVideoMime()
    setBusy('anim')
    setStatus(null)
    setProgress(0)
    try {
      const blob = mime
        ? await renderCrossfadeVideo(inputs.before, inputs.after, frame, {
            ...options.video,
            onProgress: (done, total) => setProgress(done / total),
            signal: controller.signal,
          })
        : await renderCrossfadeGif(inputs.before, inputs.after, frame, {
            transition: options.video.transition,
            width: options.video.width,
            onProgress: (done, total) => setProgress(done / total),
            signal: controller.signal,
          })
      const ext = mime ? 'mp4' : 'gif'
      const name = `b4after-${slugify(viewpoint.name)}-${fileStamp(pair.after.takenAt)}.${ext}`
      const outcome = await shareOrDownload(new File([blob], name, { type: mime ?? 'image/gif' }))
      setSheet(null)
      setStatus(outcome === 'downloaded' ? 'Export téléchargé.' : null)
    } catch (caught) {
      setStatus(
        caught instanceof DOMException && caught.name === 'AbortError'
          ? 'Export annulé.'
          : "La génération de l'export animé a échoué.",
      )
    } finally {
      abortRef.current = null
      setProgress(null)
      setBusy(null)
    }
  }

  const exportProgress = progress !== null && (
    <div data-testid="export-progress" className="space-y-1">
      <div className="h-2 overflow-hidden rounded-full bg-slate-700">
        <div
          className="h-full bg-sky-400 transition-[width]"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <p className="text-center text-xs text-slate-400">
        Encodage de l'export animé… {Math.round(progress * 100)} %
      </p>
      <button
        type="button"
        data-testid="cancel-export"
        onClick={() => abortRef.current?.abort()}
        className="w-full py-2 text-sm text-slate-300 underline"
      >
        Annuler l'export
      </button>
    </div>
  )

  return (
    <Screen
      title="Comparaison"
      back={
        <Link to={`/v/${id}`} className="text-sm text-slate-300">
          Retour
        </Link>
      }
      footer={
        pair && (
          <div className="p-2">
            {status && (
              <p
                data-testid="export-status"
                className="pb-2 text-center text-sm text-slate-300"
              >
                {status}
              </p>
            )}
            <div className="flex justify-center gap-8">
              <ExportBarButton
                testId="open-image-options"
                label="Image"
                icon={<SideBySideIcon />}
                disabled={!ready || busy !== null}
                onClick={() => setSheet('image')}
              />
              <ExportBarButton
                testId="open-video-options"
                label="Vidéo"
                icon={<PlayIcon />}
                disabled={!ready || busy !== null}
                onClick={() => setSheet('video')}
              />
            </div>
          </div>
        )
      }
    >
      <div className="flex h-full flex-col gap-4 p-4">
        {pair && frame && (
          <>
            <div className="flex min-h-0 flex-1">
              <RevealSlider
                before={
                  <ShotCanvas
                    source={beforeBitmap}
                    transform={pair.before.transform}
                    frame={frame}
                    shot={{ width: pair.before.width, height: pair.before.height }}
                    className="h-full w-full object-contain"
                  />
                }
                after={
                  <ShotCanvas
                    source={afterBitmap}
                    transform={pair.after.transform}
                    frame={frame}
                    shot={{ width: pair.after.width, height: pair.after.height }}
                    className="h-full w-full object-contain"
                  />
                }
              />
            </div>

            <p className="shrink-0 text-center text-sm text-slate-400">
              {formatDate(pair.before.takenAt)} → {formatDate(pair.after.takenAt)}
            </p>

            {!ready && (
              <p className="shrink-0 text-center text-sm text-slate-400">
                {bitmapError
                  ? 'Impossible de préparer ces photos pour la comparaison.'
                  : 'Préparation des photos…'}
              </p>
            )}
          </>
        )}

        {/* Hors du bloc `pair` : c est ici que s affiche « Comparaison introuvable ».
            Le statut de la barre du bas, lui, n existe que quand il y a une paire. */}
        {!pair && status && (
          <p data-testid="export-status" className="text-center text-sm text-slate-300">
            {status}
          </p>
        )}
      </div>

      <Sheet title="Image côte-à-côte" open={sheet === 'image'} onClose={() => setSheet(null)}>
        <OptionRow
          testId="stamp-mode"
          label="Dates sur l'image"
          value={options.image.stamp}
          options={STAMP_LABELS}
          onChange={(stamp) => updateOptions({ image: { stamp } })}
        />
        <OptionRow
          testId="layout-mode"
          label="Disposition"
          value={options.image.layout}
          options={LAYOUT_LABELS}
          onChange={(layout) => updateOptions({ image: { layout } })}
        />
        <button
          type="button"
          data-testid="export-jpeg"
          disabled={!ready || busy !== null}
          onClick={exportJpeg}
          className="w-full rounded-xl bg-sky-500 py-4 font-semibold text-slate-950 disabled:opacity-40"
        >
          Exporter l'image
        </button>
      </Sheet>

      <Sheet title="Vidéo animée" open={sheet === 'video'} onClose={() => setSheet(null)}>
        <OptionRow
          testId="transition-mode"
          label="Transition"
          value={options.video.transition}
          options={TRANSITION_LABELS}
          onChange={(transition) => updateOptions({ video: { transition } })}
        />
        <OptionRow
          testId="video-width"
          label="Qualité"
          value={options.video.width}
          options={WIDTH_LABELS}
          onChange={(width) => updateOptions({ video: { width } })}
        />
        {/* La durée ne s applique pas au repli GIF : il boucle à l infini, des
            allers-retours en plus n ajouteraient que du poids. On ne montre donc pas
            un réglage qui resterait sans effet sur ce navigateur. */}
        {videoSupported && (
          <OptionRow
            testId="video-length"
            label="Durée"
            value={options.video.reps}
            options={LENGTH_LABELS}
            onChange={(reps) => updateOptions({ video: { reps } })}
          />
        )}
        {/* data-testid historique : il datait de l export GIF que celui-ci remplace en
            priorité (avec repli sur GIF si la vidéo n est pas prise en charge). Le
            renommer serait un remue-ménage pour rien, les tests le ciblent déjà. */}
        <button
          type="button"
          data-testid="export-gif"
          disabled={!ready || busy !== null}
          onClick={exportAnimation}
          className="w-full rounded-xl border border-slate-600 py-4 disabled:opacity-40"
        >
          Exporter la vidéo
        </button>
        {exportProgress}
      </Sheet>
    </Screen>
  )
}

function ExportBarButton({
  testId,
  label,
  icon,
  disabled,
  onClick,
}: {
  testId: string
  label: string
  icon: React.ReactNode
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col items-center gap-1 px-4 py-1 text-slate-200 disabled:opacity-40"
    >
      {icon}
      <span className="text-[10px]">{label}</span>
    </button>
  )
}
```

Deux points à ne pas rater dans cette réécriture :

1. La progression vit **dans la feuille vidéo**, qui reste donc ouverte pendant
   l'encodage — c'est là que se trouve le bouton d'annulation. `setSheet(null)` est
   appelé au succès, avant `setStatus`.
2. `export-status` apparaît à **deux** endroits, jamais en même temps : dans la barre
   du bas quand il y a une paire, dans le corps quand il n'y en a pas. Le test
   « signale une comparaison introuvable » charge une comparaison inexistante, donc
   sans paire : il trouve le second. Un `data-testid` en double dans le DOM ferait
   échouer Playwright en mode strict, d'où la condition `!pair`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx tsc -b && npm run lint && npx playwright test e2e/flow.spec.ts`
Expected: PASS — les quatre exports, la mémorisation, l'absence de défilement et « signale une comparaison introuvable ».

- [ ] **Step 6: Passer toute la suite**

Run: `npm test && npx playwright test`
Expected: PASS — unitaires et e2e, y compris `e2e/offline.spec.ts` et `e2e/render.spec.ts`.

- [ ] **Step 7: Vérifier de visu**

`npm run dev`, viewport 390 × 664 : ouvrir les deux feuilles, changer chaque réglage,
lancer les deux exports, annuler un export animé en cours, et vérifier qu'une tape sur
le voile ferme bien la feuille sans déplacer le curseur de révélation en dessous.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useExportOptions.ts src/ui/CompareScreen.tsx e2e/flow.spec.ts
git commit -m "feat: barre d'export fixe et feuilles d'options sur la comparaison"
```

---

## Notes d'exécution

- **Ordre imposé.** Les Tasks 1 et 2 sont les fondations typées ; 3 à 7 traversent la
  couche de rendu ; 8 à 10 l'interface. La Task 8 laisse volontairement un test rouge
  que la Task 10 referme — c'est le seul endroit du plan où c'est le cas, et c'est
  signalé sur place.
- **Le repli GIF se teste.** `e2e/flow.spec.ts` neutralise
  `MediaRecorder.isTypeSupported` pour exercer cette branche. Après la Task 10, ce test
  doit aussi vérifier implicitement que le réglage « Durée » est absent — il ne le
  touche pas, donc il passe, mais ne pas s'étonner de ne pas voir la ligne dans ce cas.
- **Rien à défiler ≠ image minuscule.** Si l'image devient ridiculement petite sur un
  téléphone, c'est que la légende ou la barre prennent trop de place, pas que
  `object-contain` est en cause. Réduire les marges avant de toucher au dimensionnement.
