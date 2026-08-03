import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useCamera, type CapturedFrame } from '@/camera/useCamera'
import { setPendingShot } from '@/capture/pendingShot'
import { createViewpointWithFirstShot, getViewpoint, nextViewpointName } from '@/db/viewpoints'
import { useBitmap } from '@/hooks/useBitmap'
import { useShots } from '@/hooks/useShots'
import { needsRotationHint } from '@/lib/orientation'
import type { Shot, Size, Viewpoint } from '@/types'
import { CameraDeniedNotice } from './components/CameraDeniedNotice'
import { OpacitySlider } from './components/OpacitySlider'
import { Screen } from './components/Screen'
import { ShotCanvas } from './components/ShotCanvas'

export function CameraScreen() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()
  const isRetake = Boolean(id)

  const [viewpoint, setViewpoint] = useState<Viewpoint | null>(null)
  useEffect(() => {
    if (!id) return
    getViewpoint(id).then((found) => setViewpoint(found ?? null))
  }, [id])

  const { shots } = useShots(id)
  const reference: Shot | undefined = shots.at(-1)
  const referenceBitmap = useBitmap(reference?.blob)

  const frame: Size | null = viewpoint
    ? { width: viewpoint.frameWidth, height: viewpoint.frameHeight }
    : null

  const { videoRef, status, retry, capture } = useCamera({
    aspectRatio: frame ? frame.width / frame.height : undefined,
  })

  const [ghostOpacity, setGhostOpacity] = useState(0.5)
  const [rotationHint, setRotationHint] = useState(false)

  useEffect(() => {
    if (!frame) return
    const update = () =>
      setRotationHint(
        needsRotationHint({ width: window.innerWidth, height: window.innerHeight }, frame),
      )
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
    // Dépendances primitives : `frame` est un objet recréé à chaque rendu.
  }, [frame?.width, frame?.height])

  const [captured, setCaptured] = useState<CapturedFrame | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onShutter() {
    setBusy(true)
    setError(null)
    try {
      const captured = await capture()
      if (isRetake && id && frame) {
        // Rien n est écrit en base : la photo ne rejoint la série qu après validation
        // du calage.
        setPendingShot({ viewpointId: id, frame, captured })
        navigate(`/v/${id}/align`)
        return
      }
      setCaptured(captured)
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
      title={isRetake ? (viewpoint?.name ?? 'Reprise') : 'Photo de référence'}
      back={
        <Link to={isRetake && id ? `/v/${id}` : '/'} className="text-sm text-slate-300">
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

          {isRetake && frame && (
            <ShotCanvas
              data-testid="ghost"
              source={referenceBitmap}
              transform={reference?.transform ?? { scale: 1, rotation: 0, tx: 0, ty: 0 }}
              frame={frame}
              shot={{ width: reference?.width ?? frame.width, height: reference?.height ?? frame.height }}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain"
              style={{ opacity: ghostOpacity }}
            />
          )}

          {rotationHint && (
            <p
              data-testid="rotation-hint"
              className="absolute inset-x-4 top-4 rounded-lg bg-amber-900/90 p-3 text-sm"
            >
              Tournez le téléphone pour retrouver le cadrage d'origine.
            </p>
          )}

          {isRetake && (
            <div className="absolute inset-x-4 bottom-28 rounded-xl bg-slate-900/80 p-3">
              <OpacitySlider value={ghostOpacity} onChange={setGhostOpacity} />
            </div>
          )}

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
