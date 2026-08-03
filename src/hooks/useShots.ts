import { useCallback, useEffect, useState } from 'react'
import { listShots } from '@/db/shots'
import type { Shot } from '@/types'

export function useShots(viewpointId: string | undefined) {
  const [shots, setShots] = useState<Shot[]>([])
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!viewpointId) {
      // Sans remettre `loading` à faux, un appelant dont l identifiant n est pas
      // encore résolu resterait bloqué sur un chargement perpétuel.
      setShots([])
      setLoading(false)
      return
    }
    let active = true
    setLoading(true)
    listShots(viewpointId).then((result) => {
      if (!active) return
      setShots(result)
      setLoading(false)
    })
    return () => {
      active = false
    }
  }, [viewpointId, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  return { shots, loading, reload }
}
