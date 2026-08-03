import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareOrDownload } from './shareOrDownload'

const file = new File(['x'], 'export.jpg', { type: 'image/jpeg' })

function stubNavigator(value: unknown) {
  vi.stubGlobal('navigator', value)
}

function stubDownload() {
  const anchor = { href: '', download: '', click: vi.fn(), remove: vi.fn() }
  vi.stubGlobal('document', {
    createElement: () => anchor,
    body: { append: vi.fn() },
  })
  vi.stubGlobal('URL', {
    createObjectURL: () => 'blob:fake',
    revokeObjectURL: vi.fn(),
  })
  return anchor
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('shareOrDownload', () => {
  it('partage quand le navigateur accepte les fichiers', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ share, canShare: () => true })
    const anchor = stubDownload()

    expect(await shareOrDownload(file)).toBe('shared')
    expect(share).toHaveBeenCalledWith({ files: [file] })
    // Assertion explicite, et non protection accidentelle par l absence de
    // `document` en environnement Node : un partage réussi ne doit pas déclencher
    // un téléchargement en plus.
    expect(anchor.click).not.toHaveBeenCalled()
  })

  it('télécharge quand le partage de fichiers est indisponible', async () => {
    stubNavigator({})
    const anchor = stubDownload()

    expect(await shareOrDownload(file)).toBe('downloaded')
    expect(anchor.download).toBe('export.jpg')
    expect(anchor.click).toHaveBeenCalled()
  })

  it('télécharge quand canShare refuse ce type de fichier', async () => {
    const share = vi.fn()
    stubNavigator({ share, canShare: () => false })
    stubDownload()

    expect(await shareOrDownload(file)).toBe('downloaded')
    expect(share).not.toHaveBeenCalled()
  })

  it('ne retombe pas sur le téléchargement quand l utilisateur annule', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('annulé', 'AbortError'))
    stubNavigator({ share, canShare: () => true })
    const anchor = stubDownload()

    expect(await shareOrDownload(file)).toBe('cancelled')
    // Le cœur de la fonction : une annulation n est pas un échec, et rien ne doit
    // partir en téléchargement dans le dos de l utilisateur.
    expect(anchor.click).not.toHaveBeenCalled()
  })

  it('retombe sur le téléchargement si le partage échoue vraiment', async () => {
    const share = vi.fn().mockRejectedValue(new Error('boom'))
    stubNavigator({ share, canShare: () => true })
    const anchor = stubDownload()

    expect(await shareOrDownload(file)).toBe('downloaded')
    expect(anchor.click).toHaveBeenCalled()
  })
})
