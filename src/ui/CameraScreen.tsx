import { useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useCamera, type CapturedFrame } from '@/camera/useCamera'
import { createViewpointWithFirstShot, nextViewpointName } from '@/db/viewpoints'
import { CameraDeniedNotice } from './components/CameraDeniedNotice'
import { Screen } from './components/Screen'

export function CameraScreen() {
  const navigate = useNavigate()
  const { videoRef, status, retry, capture } = useCamera({})
  const [captured, setCaptured] = useState<CapturedFrame | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onShutter() {
    setBusy(true)
    setError(null)
    try {
      const frame = await capture()
      setCaptured(frame)
      setName(await nextViewpointName())
    } catch {
      setError('La capture a échoué. Réessayez.')
    } finally {
      setBusy(false)
    }
  }

  async function onConfirm() {
    if (!captured) return
    setBusy(true)
    setError(null)
    try {
      // Une seule transaction : un échec ne doit pas laisser un point de vue sans
      // photo dans la liste, ni chaque nouvelle tentative en créer un de plus.
      await createViewpointWithFirstShot({
        name: name.trim() || (await nextViewpointName()),
        width: captured.width,
        height: captured.height,
        blob: captured.blob,
        thumbBlob: captured.thumbBlob,
      })
      navigate('/', { replace: true })
    } catch {
      // La photo reste en mémoire : l utilisateur peut réessayer sans la reprendre.
      setError("L'enregistrement a échoué. L'espace de stockage est peut-être plein.")
      setBusy(false)
    }
  }

  return (
    <Screen
      title="Photo de référence"
      back={
        <Link to="/" className="text-sm text-slate-300">
          Annuler
        </Link>
      }
    >
      {status === 'denied' || status === 'unavailable' ? (
        <CameraDeniedNotice status={status} onRetry={retry} />
      ) : (
        <div className="relative h-full">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            className="h-full w-full bg-black object-contain"
          />

          {!captured && (
            <button
              type="button"
              data-testid="shutter"
              disabled={status !== 'ready' || busy}
              onClick={onShutter}
              className="absolute bottom-6 left-1/2 size-20 -translate-x-1/2 rounded-full border-4 border-white bg-white/30 disabled:opacity-40"
              aria-label="Prendre la photo"
            />
          )}

          {captured && (
            <div
              data-testid="name-sheet"
              className="absolute inset-x-0 bottom-0 space-y-3 bg-slate-800 p-4"
            >
              <label className="block text-sm text-slate-300" htmlFor="viewpoint-name">
                Nom du point de vue
              </label>
              <input
                id="viewpoint-name"
                data-testid="name-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full rounded-lg bg-slate-900 px-3 py-3"
              />
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setCaptured(null)}
                  className="flex-1 rounded-xl border border-slate-600 py-3"
                >
                  Reprendre
                </button>
                <button
                  type="button"
                  data-testid="name-confirm"
                  disabled={busy}
                  onClick={onConfirm}
                  className="flex-1 rounded-xl bg-sky-500 py-3 font-semibold text-slate-950 disabled:opacity-40"
                >
                  Enregistrer
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="absolute inset-x-4 top-4 rounded-lg bg-red-900/90 p-3 text-sm">
              {error}
            </p>
          )}
        </div>
      )}
    </Screen>
  )
}
