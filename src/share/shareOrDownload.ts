/**
 * Passe le fichier au partage natif quand c est possible, sinon déclenche un
 * téléchargement. Une annulation utilisateur n est pas un échec : on ne déclenche
 * pas de téléchargement derrière son dos.
 */
export async function shareOrDownload(
  file: File,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const canShareFiles =
    typeof navigator.share === 'function' &&
    typeof navigator.canShare === 'function' &&
    navigator.canShare({ files: [file] })

  if (canShareFiles) {
    try {
      await navigator.share({ files: [file] })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // Un vrai échec de partage : on ne laisse pas l utilisateur sans son fichier.
    }
  }

  download(file)
  return 'downloaded'
}

function download(file: File): void {
  const url = URL.createObjectURL(file)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.name
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}
