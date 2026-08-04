import { useCallback, useEffect, useState } from 'react'
import { listViewpoints } from '@/db/viewpoints'
import type { ViewpointSummary } from '@/types'

export function useViewpoints() {
  const [summaries, setSummaries] = useState<ViewpointSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    setError(false)
    listViewpoints()
      .then((result) => {
        if (!active) return
        setSummaries(result)
        setLoading(false)
      })
      .catch(() => {
        // Sans ce filet, un rejet (store IndexedDB bloqué ou corrompu) laisserait
        // `loading` à vrai pour toujours : l accueil n afficherait jamais ni la liste
        // ni l état vide, sans un mot d explication.
        if (!active) return
        setError(true)
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { summaries, loading, error, reload }
}
