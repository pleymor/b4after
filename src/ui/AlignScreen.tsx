import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { createGestureState, gestureReducer, type GestureEvent } from '@/align/gesture'
import { toFrameCoords } from '@/align/surface'
import { IDENTITY, clampToCover } from '@/align/transform'
import { peekPendingShot, takePendingShot } from '@/capture/pendingShot'
import { addShot } from '@/db/shots'
import { isQuotaError } from '@/db/storage'
import { useBitmap } from '@/hooks/useBitmap'
import { useShots } from '@/hooks/useShots'
import type { Size, Transform } from '@/types'
import { OpacitySlider } from './components/OpacitySlider'
import { ShotCanvas } from './components/ShotCanvas'
import { Screen } from './components/Screen'

export function AlignScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  // La photo en attente vit en mémoire : un rechargement de page annule le calage,
  // et on renvoie l utilisateur à sa série plutôt que d afficher un écran vide.
  const pending = useMemo(() => peekPendingShot(), [])
  useEffect(() => {
    if (!pending || pending.viewpointId !== id) navigate(`/v/${id}`, { replace: true })
  }, [pending, id, navigate])

  const { shots } = useShots(id)
  const reference = shots.at(-1)
  const referenceBitmap = useBitmap(reference?.blob)
  const capturedBitmap = useBitmap(pending?.captured.blob)

  // `pending` est mémoïsé une fois pour toutes : ces deux objets doivent l être aussi,
  // sinon l effet qui recrée l état de geste se rejouerait à chaque rendu et
  // réinitialiserait le calage au milieu d un glissement.
  const frame = useMemo<Size>(() => pending?.frame ?? { width: 1, height: 1 }, [pending])
  const shotSize = useMemo<Size>(
    () =>
      pending
        ? { width: pending.captured.width, height: pending.captured.height }
        : { width: 1, height: 1 },
    [pending],
  )

  const initial = useMemo(() => clampToCover(IDENTITY, shotSize, frame), [shotSize, frame])

  const [transform, setTransform] = useState<Transform>(initial)
  useEffect(() => setTransform(initial), [initial])

  const [opacity, setOpacity] = useState(0.5)
  const [swapped, setSwapped] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const writingRef = useRef(false)
  const gestureRef = useRef(createGestureState(initial, shotSize, frame))
  useEffect(() => {
    gestureRef.current = createGestureState(initial, shotSize, frame)
  }, [initial, shotSize, frame])

  /** Convertit un pointeur en pixels du cadre canonique, ce qu attend le réducteur. */
  function pointerToFrame(event: React.PointerEvent) {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return toFrameCoords({ x: event.clientX, y: event.clientY }, rect, frame)
  }

  function dispatch(event: GestureEvent) {
    gestureRef.current = gestureReducer(gestureRef.current, event)
    setTransform(gestureRef.current.transform)
  }

  async function onConfirm() {
    // Garde synchrone : `busy` ne prend effet qu au rendu suivant, donc deux tapes
    // rapprochées pourraient toutes deux entrer ici.
    if (writingRef.current) return
    const shot = peekPendingShot()
    if (!shot || !id) return

    writingRef.current = true
    setBusy(true)
    setError(null)
    try {
      await addShot({
        viewpointId: id,
        blob: shot.captured.blob,
        thumbBlob: shot.captured.thumbBlob,
        width: shot.captured.width,
        height: shot.captured.height,
        transform,
      })
      // Ne consommer la photo qu après une écriture réussie. La drainer avant
      // rendrait tout échec irrécupérable : « Valider » redeviendrait un no-op
      // silencieux, et la photo serait définitivement perdue.
      takePendingShot()
      navigate(`/v/${id}`, { replace: true })
    } catch (caught) {
      // La photo reste en attente : un nouvel essai est possible sans reprendre.
      writingRef.current = false
      setError(
        isQuotaError(caught)
          ? "L'espace de stockage est plein. Supprimez d'anciennes photos, puis réessayez — celle-ci n'est pas perdue."
          : "L'enregistrement a échoué. Réessayez.",
      )
      setBusy(false)
    }
  }

  if (!pending) return null

  const layers = [
    {
      key: 'reference',
      source: referenceBitmap,
      transform: reference?.transform ?? IDENTITY,
      shot: {
        width: reference?.width ?? frame.width,
        height: reference?.height ?? frame.height,
      },
    },
    { key: 'captured', source: capturedBitmap, transform, shot: shotSize },
  ]
  const ordered = swapped ? [...layers].reverse() : layers

  return (
    <Screen title="Caler la photo">
      <div className="flex h-full flex-col gap-3 p-3">
        <div
          ref={surfaceRef}
          data-testid="align-surface"
          className="relative min-h-0 flex-1 touch-none overflow-hidden rounded-xl bg-black"
          style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            const { x, y } = pointerToFrame(event)
            dispatch({ type: 'down', id: event.pointerId, x, y })
          }}
          onPointerMove={(event) => {
            const { x, y } = pointerToFrame(event)
            dispatch({ type: 'move', id: event.pointerId, x, y })
          }}
          onPointerUp={(event) => dispatch({ type: 'up', id: event.pointerId })}
          onPointerCancel={(event) => dispatch({ type: 'up', id: event.pointerId })}
        >
          {ordered.map((layer, index) => (
            <ShotCanvas
              key={layer.key}
              source={layer.source}
              transform={layer.transform}
              frame={frame}
              shot={layer.shot}
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{ opacity: index === 0 ? 1 : opacity }}
            />
          ))}
        </div>

        <OpacitySlider value={opacity} onChange={setOpacity} label="Opacité du calque du dessus" />

        <div className="flex gap-2 text-sm">
          <button
            type="button"
            data-testid="swap-layers"
            onClick={() => setSwapped((value) => !value)}
            className="flex-1 rounded-xl border border-slate-600 py-3"
          >
            Permuter
          </button>
          <button
            type="button"
            data-testid="align-reset"
            onClick={() => {
              gestureRef.current = createGestureState(initial, shotSize, frame)
              setTransform(initial)
            }}
            className="flex-1 rounded-xl border border-slate-600 py-3"
          >
            Remettre à zéro
          </button>
          <button
            type="button"
            data-testid="align-retake"
            onClick={() => {
              takePendingShot()
              navigate(`/v/${id}/capture`, { replace: true })
            }}
            className="flex-1 rounded-xl border border-slate-600 py-3"
          >
            Reprendre
          </button>
        </div>

        <button
          type="button"
          data-testid="align-confirm"
          disabled={busy}
          onClick={onConfirm}
          className="rounded-xl bg-sky-500 py-4 font-semibold text-slate-950 disabled:opacity-40"
        >
          Valider
        </button>

        {error && <p className="rounded-lg bg-red-900/90 p-3 text-sm">{error}</p>}
      </div>
    </Screen>
  )
}
