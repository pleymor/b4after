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
