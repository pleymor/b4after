import { useEffect, useRef, useState } from 'react'
import { createGestureState, gestureReducer, type GestureEvent } from '@/align/gesture'
import { toFrameCoords } from '@/align/surface'
import { IDENTITY } from '@/align/transform'
import type { Drawable } from '@/render/drawShot'
import type { Size, Transform } from '@/types'
import { OpacitySlider } from './OpacitySlider'
import { ShotCanvas } from './ShotCanvas'

/** Le calque du dessous, sur lequel on cale. Absent quand il n y a rien à superposer. */
export type GhostLayer = { source: Drawable | null; transform: Transform; shot: Size }

/**
 * La surface de calage : deux calques superposés dans le cadre canonique, les gestes
 * qui déplacent celui du dessus, et les réglages qui aident à juger la superposition.
 *
 * Elle ne sait rien de la provenance de la photo ni de ce qu on en fera : c est ce qui
 * lui permet de servir aussi bien la photo qu on vient de prendre que celle qu on
 * rouvre pour la recadrer. Les écrans, eux, ne portent plus que leur propre circuit.
 *
 * Un fragment, pas une boîte : ses trois blocs restent enfants directs de la colonne
 * de l écran, donc la surface continue de prendre la hauteur restante.
 */
export function AlignSurface({
  source,
  shot,
  frame,
  ghost,
  initial,
  value,
  onChange,
  controls = true,
  extraControl,
}: {
  source: Drawable | null
  shot: Size
  frame: Size
  ghost: GhostLayer | null
  /** Le cadrage de départ, celui que « Remettre à zéro » restitue. */
  initial: Transform
  value: Transform
  onChange: (transform: Transform) => void
  /** Retirés, et pas seulement grisés, quand l écran est occupé à écrire. */
  controls?: boolean
  /**
   * Le bouton propre à l écran, posé au bout de la même rangée : « Reprendre » pour la
   * photo qu on vient de prendre, « Annuler » pour celle qu on rouvre. Il disparaît
   * avec les autres quand `controls` retombe.
   */
  extraControl?: React.ReactNode
}) {
  const [opacity, setOpacity] = useState(0.5)
  const [swapped, setSwapped] = useState(false)

  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const gestureRef = useRef(createGestureState(initial, shot, frame))
  useEffect(() => {
    gestureRef.current = createGestureState(initial, shot, frame)
  }, [initial, shot, frame])

  /** Convertit un pointeur en pixels du cadre canonique, ce qu attend le réducteur. */
  function pointerToFrame(event: React.PointerEvent) {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return toFrameCoords({ x: event.clientX, y: event.clientY }, rect, frame)
  }

  function dispatch(event: GestureEvent) {
    gestureRef.current = gestureReducer(gestureRef.current, event)
    onChange(gestureRef.current.transform)
  }

  const layers = [
    {
      key: 'ghost',
      source: ghost?.source ?? null,
      transform: ghost?.transform ?? IDENTITY,
      shot: ghost?.shot ?? frame,
    },
    { key: 'aligned', source, transform: value, shot },
  ]
  const ordered = swapped ? [...layers].reverse() : layers

  return (
    <>
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

      {controls && (
        <div className="flex gap-2 text-sm">
          <button
            type="button"
            data-testid="swap-layers"
            onClick={() => setSwapped((swap) => !swap)}
            className="flex-1 rounded-xl border border-slate-600 py-3"
          >
            Permuter
          </button>
          <button
            type="button"
            data-testid="align-reset"
            onClick={() => {
              gestureRef.current = createGestureState(initial, shot, frame)
              onChange(initial)
            }}
            className="flex-1 rounded-xl border border-slate-600 py-3"
          >
            Remettre à zéro
          </button>
          {extraControl}
        </div>
      )}
    </>
  )
}
