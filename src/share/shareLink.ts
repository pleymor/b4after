/**
 * Partage une URL par le partage natif, sinon la copie dans le presse-papier.
 *
 * Distinct de `shareOrDownload` : `navigator.share({ files })` et
 * `navigator.share({ url })` sont deux formes d appel différentes, et le repli n est
 * pas le même — un lien se copie, il ne se télécharge pas. Même convention en
 * revanche sur l annulation : ce n est pas un échec, et on ne fait rien derrière le
 * dos de l utilisateur.
 */
export async function shareLink(
  url: string,
  title: string,
): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // Un vrai échec de partage : on tente quand même de rendre le lien utilisable.
    }
  }

  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(url)
      return 'copied'
    } catch {
      return 'failed'
    }
  }

  return 'failed'
}
