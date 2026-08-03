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
