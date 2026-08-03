import { useEffect, useState } from 'react'

/** Décode un blob en ImageBitmap et le libère au changement. */
export function useBitmap(blob: Blob | null | undefined): ImageBitmap | null {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)

  useEffect(() => {
    if (!blob) {
      setBitmap(null)
      return
    }
    let current: ImageBitmap | null = null
    let active = true
    // Repartir de zéro dès que le blob change : sinon l état continue de référencer
    // le bitmap précédent, que le nettoyage vient de fermer, et un consommateur qui
    // le dessinerait lèverait InvalidStateError. C est un scénario courant ici,
    // puisque les écrans de calage et de comparaison basculent d une photo à l autre.
    setBitmap(null)
    createImageBitmap(blob).then((decoded) => {
      if (!active) {
        decoded.close()
        return
      }
      current = decoded
      setBitmap(decoded)
    })
    return () => {
      active = false
      current?.close()
    }
  }, [blob])

  return bitmap
}
