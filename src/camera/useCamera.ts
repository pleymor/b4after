import { useCallback, useEffect, useRef, useState } from 'react'
import { makeThumbnail } from '@/render/thumbnail'

export type CameraStatus = 'starting' | 'ready' | 'denied' | 'unavailable'

export type CapturedFrame = {
  blob: Blob
  thumbBlob: Blob
  width: number
  height: number
}

export const CAPTURE_QUALITY = 0.9

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
      const live = streamRef.current?.getVideoTracks().some((t) => t.readyState === 'live')
      if (document.visibilityState === 'visible' && !live) setNonce((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const capture = useCallback(async (): Promise<CapturedFrame> => {
    const video = videoRef.current
    if (!video || !video.videoWidth) throw new Error('Flux vidéo indisponible')

    const width = video.videoWidth
    const height = video.videoHeight
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Contexte 2D indisponible')
    ctx.drawImage(video, 0, 0, width, height)

    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: CAPTURE_QUALITY })
    const bitmap = await createImageBitmap(blob)
    try {
      const thumbBlob = await makeThumbnail(bitmap, { width, height })
      return { blob, thumbBlob, width, height }
    } finally {
      bitmap.close()
    }
  }, [])

  const retry = useCallback(() => setNonce((n) => n + 1), [])

  return { videoRef, status, retry, capture }
}
