import { describe, expect, it, vi } from 'vitest'
import { startEncoding } from './pendingEncode'

describe('startEncoding', () => {
  it('démarre le travail sans attendre le premier appel à result', async () => {
    const encode = vi.fn(async () => 'jpeg')
    const pending = startEncoding(encode)

    // Tout l intérêt : le travail tourne déjà pendant que l utilisateur regarde sa
    // photo. Attendre `result()` pour le lancer ramènerait l attente entière au
    // moment d enregistrer.
    expect(encode).toHaveBeenCalledTimes(1)
    await expect(pending.result()).resolves.toBe('jpeg')
  })

  it('ne relance pas le travail à chaque appel à result', async () => {
    const encode = vi.fn(async () => 'jpeg')
    const pending = startEncoding(encode)

    await Promise.all([pending.result(), pending.result()])
    await pending.result()

    expect(encode).toHaveBeenCalledTimes(1)
  })

  it('signale par isDone que le résultat est déjà disponible', async () => {
    let release: (value: string) => void = () => undefined
    const pending = startEncoding(() => new Promise<string>((resolve) => (release = resolve)))

    expect(pending.isDone()).toBe(false)
    release('jpeg')
    await pending.result()
    expect(pending.isDone()).toBe(true)
  })

  it('relance un encodage neuf après un échec', async () => {
    const encode = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('encodeur indisponible'))
      .mockResolvedValueOnce('jpeg')
    const pending = startEncoding(encode)

    await expect(pending.result()).rejects.toThrow('encodeur indisponible')
    // Sans cette relance, un échec transitoire condamnerait la photo : le bouton
    // « Enregistrer » retomberait indéfiniment sur la même promesse rejetée.
    await expect(pending.result()).resolves.toBe('jpeg')
    expect(encode).toHaveBeenCalledTimes(2)
    expect(pending.isDone()).toBe(true)
  })

  it('ne laisse pas un rejet non géré quand personne n attend encore', async () => {
    // `process` n est pas déclaré dans les types de l app — les tests tournent en
    // environnement node, mais le reste du code cible le navigateur.
    const { process } = globalThis as unknown as {
      process: {
        on(event: 'unhandledRejection', listener: () => void): void
        off(event: 'unhandledRejection', listener: () => void): void
      }
    }

    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      startEncoding(async () => {
        throw new Error('encodeur indisponible')
      })
      // Laisser passer les micro-tâches puis un tour de boucle : c est là que Node
      // signale les rejets restés sans gestionnaire.
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
