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

    expect(await shareOrDownload(file)).toBe('shared')
    expect(share).toHaveBeenCalledWith({ files: [file] })
  })

  it('télécharge quand le partage de fichiers est indisponible', async () => {
    stubNavigator({})
    const anchor = stubDownload()

    expect(await shareOrDownload(file)).toBe('downloaded')
    expect(anchor.download).toBe('export.jpg')
    expect(anchor.click).toHaveBeenCalled()
  })

  it('télécharge quand canShare refuse ce type de fichier', async () => {
    stubNavigator({ share: vi.fn(), canShare: () => false })
    stubDownload()

    expect(await shareOrDownload(file)).toBe('downloaded')
  })

  it('ne retombe pas sur le téléchargement quand l utilisateur annule', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('annulé', 'AbortError'))
    stubNavigator({ share, canShare: () => true })

    expect(await shareOrDownload(file)).toBe('cancelled')
  })

  it('retombe sur le téléchargement si le partage échoue vraiment', async () => {
    const share = vi.fn().mockRejectedValue(new Error('boom'))
    stubNavigator({ share, canShare: () => true })
    const anchor = stubDownload()

    expect(await shareOrDownload(file)).toBe('downloaded')
    expect(anchor.click).toHaveBeenCalled()
  })
})
