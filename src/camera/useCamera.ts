import { useCallback, useEffect, useRef, useState } from 'react'
import { triggerFlash } from '@/capture/flash'
import { startEncoding, type PendingEncode } from '@/capture/pendingEncode'
import { encodeFrame, type EncodedFrame } from '@/render/encodeFrame'

export type CameraStatus = 'starting' | 'ready' | 'denied' | 'unavailable'

/**
 * Une prise, telle qu elle existe dès la tape : une image affichable et un encodage en
 * cours. `source` est un `Drawable`, donc directement dessinable par `ShotCanvas` — rien
 * n attend le JPEG pour montrer la photo.
 */
export type CapturedFrame = {
  source: OffscreenCanvas
  width: number
  height: number
  encoding: PendingEncode<EncodedFrame>
}

/**
 * Possède le cycle de vie du MediaStream : c est le seul module de l app qui en
 * manipule un. Reprend la capture au retour d arrière-plan, où Android coupe la piste.
 */
export function useCamera(options: { aspectRatio?: number }) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [status, setStatus] = useState<CameraStatus>('starting')
  const [nonce, setNonce] = useState(0)
  const { aspectRatio } = options

  useEffect(() => {
    let cancelled = false

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus('unavailable')
        return
      }
      setStatus('starting')
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            ...(aspectRatio ? { aspectRatio: { ideal: aspectRatio } } : {}),
          },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => undefined)
        }
        setStatus('ready')
      } catch (error) {
        if (cancelled) return
        const name = error instanceof DOMException ? error.name : ''
        setStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'unavailable')
      }
    }

    start()

    return () => {
      cancelled = true
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
  }, [aspectRatio, nonce])

  // Android coupe la piste vidéo quand l onglet passe en arrière-plan : on relance.
  useEffect(() => {
    function onVisibility() {
      if (document.visibilityState !== 'visible') return
      // Ne rien faire tant qu aucun flux n a été obtenu : soit une ouverture est en
      // cours — et relancer déclencherait un second getUserMedia concurrent, donc
      // une seconde demande de permission — soit l accès a été refusé, et c est au
      // bouton « Réessayer » de reprendre la main.
      if (!streamRef.current) return
      const live = streamRef.current.getVideoTracks().some((t) => t.readyState === 'live')
      if (!live) setNonce((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  /**
   * Saisit la trame courante, sans aucun `await`.
   *
   * L encodage JPEG coûte plusieurs secondes sur mobile, mais il ne sert qu à
   * l écriture en base : le faire précéder l affichage laissait l écran figé sur le flux
   * vivant, sans le moindre signe que la tape avait été prise en compte. On dessine donc
   * la trame, on rend une image affichable immédiatement, et on encode derrière.
   *
   * Synchrone à dessein : la photo affichée est exactement celle de l instant de la
   * tape, sans dérive d une trame gagnée en attendant une promesse.
   */
  const capture = useCallback((): CapturedFrame => {
    const video = videoRef.current
    if (!video || !video.videoWidth) throw new Error('Flux vidéo indisponible')

    const width = video.videoWidth
    const height = video.videoHeight

    const source = new OffscreenCanvas(width, height)
    const ctx = source.getContext('2d')
    if (!ctx) throw new Error('Contexte 2D indisponible')
    ctx.drawImage(video, 0, 0, width, height)

    triggerFlash()

    return {
      source,
      width,
      height,
      encoding: startEncoding(() => encodeFrame(source, { width, height })),
    }
  }, [])

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  return { videoRef, status, retry, capture }
}
