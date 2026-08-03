import { useCallback, useEffect, useState } from 'react'
import { listViewpoints } from '@/db/viewpoints'
import type { ViewpointSummary } from '@/types'

export function useViewpoints() {
  const [summaries, setSummaries] = useState<ViewpointSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    let active = true
    setLoading(true)
    listViewpoints().then((result) => {
      if (!active) return
      setSummaries(result)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { summaries, loading, reload }
}
