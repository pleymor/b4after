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

  it('fixe la largeur d image par défaut à 2048 px', () => {
    // Littéral, pas dérivé : c est la valeur que `renderSideBySide` appliquait déjà
    // en dur avant l existence du réglage (`EXPORT_MAX_EDGE`). La changer ici sans
    // le vouloir changerait le rendu de tous ceux qui n ont jamais ouvert la feuille
    // de réglages (voir la spec de comparaison de série).
    expect(DEFAULT_EXPORT_OPTIONS.image.width).toBe(2048)
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
      image: { stamp: 'datetime', layout: 'vertical', stampScale: 1.5, width: 1024 },
      video: { transition: 'wipe', width: 1080, reps: 5, pace: 'slow' },
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

  it('rend le rythme par défaut sur une valeur absente, inconnue ou mal typée', () => {
    // Comme les autres réglages de la feuille vidéo : une liste fermée (`oneOf`), pas
    // un intervalle. « turbo » et un nombre sont deux façons différentes d en sortir.
    const fallback = DEFAULT_EXPORT_OPTIONS.video.pace

    expect(parseExportOptions('{"video":{}}').video.pace).toBe(fallback)
    expect(parseExportOptions('{"video":{"pace":"turbo"}}').video.pace).toBe(fallback)
    expect(parseExportOptions('{"video":{"pace":42}}').video.pace).toBe(fallback)
  })

  it('relit une taille de bandeau valide', () => {
    const parsed = parseExportOptions('{"image":{"stampScale":1.7}}')
    expect(parsed.image.stampScale).toBe(1.7)
  })

  it('ramène une taille de bandeau absente, hors bornes ou non numérique au défaut', () => {
    // `stampScale` n est pas une liste fermée : `oneOf` ne s applique pas, il faut
    // donc vérifier chaque façon de sortir de l intervalle [0.5, 2].
    const fallback = DEFAULT_EXPORT_OPTIONS.image.stampScale

    expect(parseExportOptions('{"image":{}}').image.stampScale).toBe(fallback)
    expect(parseExportOptions('{"image":{"stampScale":0.4}}').image.stampScale).toBe(fallback)
    expect(parseExportOptions('{"image":{"stampScale":2.1}}').image.stampScale).toBe(fallback)
    expect(parseExportOptions('{"image":{"stampScale":"1"}}').image.stampScale).toBe(fallback)
    // `1e400` est un littéral JSON valide, mais dépasse la précision d un flottant
    // double : `JSON.parse` le rend en `Infinity`, un « nombre » au sens de `typeof`
    // que seul `Number.isFinite` peut écarter — comme `NaN` le serait s il pouvait
    // être exprimé en JSON, ce qu il ne peut pas.
    expect(parseExportOptions('{"image":{"stampScale":1e400}}').image.stampScale).toBe(fallback)
  })

  it('relit une largeur d image valide, y compris `full`', () => {
    expect(parseExportOptions('{"image":{"width":1024}}').image.width).toBe(1024)
    expect(parseExportOptions('{"image":{"width":"full"}}').image.width).toBe('full')
  })

  it('rend la largeur d image par défaut sur une valeur absente ou inconnue', () => {
    // Comme les autres réglages en liste fermée (`oneOf`) : ni 1080 (une largeur
    // vidéo, pas image) ni une chaîne quelconque ne font partie de `IMAGE_WIDTHS`.
    const fallback = DEFAULT_EXPORT_OPTIONS.image.width

    expect(parseExportOptions('{"image":{}}').image.width).toBe(fallback)
    expect(parseExportOptions('{"image":{"width":1080}}').image.width).toBe(fallback)
    expect(parseExportOptions('{"image":{"width":"maximale"}}').image.width).toBe(fallback)
  })
})

describe('loadExportOptions / saveExportOptions', () => {
  it('fait un aller-retour fidèle', () => {
    stubStorage()
    const options = {
      image: { stamp: 'none', layout: 'horizontal', stampScale: 1.3, width: 'full' },
      video: { transition: 'cut', width: 'full', reps: 1, pace: 'fast' },
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
