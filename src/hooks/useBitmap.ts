import { useEffect, useState } from 'react'

/**
 * Décode un blob en ImageBitmap et le libère au changement.
 *
 * `bitmap` reste `null` aussi bien pendant le décodage qu après un échec : c est au
 * consommateur d exposer `error` s il doit distinguer les deux (un blob illisible —
 * store corrompu, format inattendu — ne doit jamais laisser un écran deviner tout
 * seul pourquoi rien ne s affiche).
 */
export function useBitmap(blob: Blob | null | undefined): { bitmap: ImageBitmap | null; error: boolean } {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    if (!blob) {
      setBitmap(null)
      setError(false)
      return
    }
    let current: ImageBitmap | null = null
    let active = true
    // Repartir de zéro dès que le blob change : sinon l état continue de référencer
    // le bitmap précédent, que le nettoyage vient de fermer, et un consommateur qui
    // le dessinerait lèverait InvalidStateError. C est un scénario courant ici,
    // puisque les écrans de calage et de comparaison basculent d une photo à l autre.
    setBitmap(null)
    setError(false)
    createImageBitmap(blob)
      .then((decoded) => {
        if (!active) {
          decoded.close()
          return
        }
        current = decoded
        setBitmap(decoded)
      })
      .catch(() => {
        if (active) setError(true)
      })
    return () => {
      active = false
      current?.close()
    }
  }, [blob])

  return { bitmap, error }
}
