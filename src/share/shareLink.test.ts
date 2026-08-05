import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareLink } from './shareLink'

const URL_TO_SHARE = 'https://exemple.test'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Faux `navigator` : `share` et `clipboard` sont posés à la demande. */
function stubNavigator(value: unknown) {
  vi.stubGlobal('navigator', value)
}

describe('shareLink', () => {
  it('passe par le partage natif quand il existe', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    stubNavigator({ share, clipboard: { writeText } })

    expect(await shareLink(URL_TO_SHARE, 'b4after')).toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 'b4after', url: URL_TO_SHARE })
    // Un partage réussi ne doit pas copier en plus : l utilisateur a déjà agi.
    expect(writeText).not.toHaveBeenCalled()
  })

  it('ne copie rien quand l utilisateur annule', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('annulé', 'AbortError'))
    const writeText = vi.fn()
    stubNavigator({ share, clipboard: { writeText } })

    // Même convention que `shareOrDownload` : une annulation n est pas un échec, et
    // rien ne doit atterrir dans le presse-papier dans le dos de l utilisateur.
    expect(await shareLink(URL_TO_SHARE, 'b4after')).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copie quand le partage natif est absent', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ clipboard: { writeText } })

    expect(await shareLink(URL_TO_SHARE, 'b4after')).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(URL_TO_SHARE)
  })

  it('copie quand le partage échoue vraiment', async () => {
    const share = vi.fn().mockRejectedValue(new Error('boom'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ share, clipboard: { writeText } })

    expect(await shareLink(URL_TO_SHARE, 'b4after')).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(URL_TO_SHARE)
  })

  it('rend failed quand le presse-papier refuse', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('refusé', 'NotAllowedError'))
    stubNavigator({ clipboard: { writeText } })

    expect(await shareLink(URL_TO_SHARE, 'b4after')).toBe('failed')
  })

  it('rend failed quand ni partage ni presse-papier ne sont disponibles', async () => {
    stubNavigator({})

    expect(await shareLink(URL_TO_SHARE, 'b4after')).toBe('failed')
  })
})
