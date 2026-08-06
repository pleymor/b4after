import { useEffect, useRef, useState } from 'react'
import { drawShot } from '@/render/drawShot'
import { formatDate } from '@/lib/format'
import type { Shot, Size } from '@/types'

/**
 * Plafond de décodage de l aperçu : bien sous la résolution native d une photo, pour
 * rester fluide pendant le glissement et ne jamais garder une photo pleine résolution
 * en mémoire (voir la spec de comparaison de série, § Mémoire — même principe que
 * `resizeWidth` côté export, mais pour l affichage plutôt que le fichier produit).
 */
const PREVIEW_DECODE_MAX_EDGE = 960

/**
 * Décode le blob d une photo en réduit, et le libère au changement de photo ou au
 * démontage. `null` tant qu il n y a rien à décoder (pas de voisin à cette position).
 */
function useReducedBitmap(shot: Shot | undefined): ImageBitmap | null {
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null)

  useEffect(() => {
    if (!shot) {
      setBitmap(null)
      return
    }
    let current: ImageBitmap | null = null
    let active = true
    setBitmap(null)
    const factor = Math.min(1, PREVIEW_DECODE_MAX_EDGE / Math.max(shot.width, shot.height))
    createImageBitmap(shot.blob, {
      resizeWidth: Math.max(1, Math.round(shot.width * factor)),
      resizeQuality: 'medium',
    })
      .then((decoded) => {
        if (!active) {
          decoded.close()
          return
        }
        current = decoded
        setBitmap(decoded)
      })
      .catch(() => {
        // Un aperçu manqué reste silencieux : cet écran ne dépend pas de ce canevas
        // pour comparer et exporter, seulement pour vérifier le calage à l œil.
      })
    return () => {
      active = false
      current?.close()
    }
  }, [shot])

  return bitmap
}

/**
 * Curseur temporel sur toute la série : une réglette de `0` à `N-1`, un fondu entre la
 * photo `floor(v)` et la suivante d opacité `v - floor(v)`. Remplace la poignée de
 * révélation d origine, qui ne comparait que deux photos par construction — même
 * geste, même rôle (vérifier le calage avant d exporter), mais sur toute la série.
 */
export function SeriesScrubber({ shots, frame }: { shots: Shot[]; frame: Size }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  // Position de départ au milieu de la série : comme l ancienne poignée démarrait à
  // 0,5 (moitié avant, moitié après), un mélange à mi-parcours donne d emblée quelque
  // chose à voir plutôt qu une seule photo immobile.
  const [position, setPosition] = useState(() => (shots.length - 1) / 2)

  const clamped = Math.min(shots.length - 1, Math.max(0, position))
  const index = Math.floor(clamped)
  const nextIndex = Math.min(shots.length - 1, index + 1)
  const opacity = clamped - index
  const hasNext = nextIndex !== index

  const current = shots[index]
  const next = hasNext ? shots[nextIndex] : undefined

  const currentBitmap = useReducedBitmap(current)
  const nextBitmap = useReducedBitmap(next)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    // Un déplacement rapide du curseur change `current`/`next` (les photos) et leur
    // bitmap décodé sur le même commit : l effet qui ferme l ancien bitmap et cet
    // effet de dessin s exécutent dans le même passage, dans l ordre de déclaration
    // des hooks, avant que l état ne se stabilise sur `null` puis sur le nouveau
    // bitmap. Le bitmap lu ici peut donc, l espace d un commit, être déjà fermé —
    // sans conséquence puisqu un nouveau rendu suit immédiatement, mais `drawImage`
    // lèverait sans ce filet.
    try {
      if (currentBitmap && current) {
        drawShot(ctx, currentBitmap, current.transform, frame, {
          width: current.width,
          height: current.height,
        })
      }
      if (opacity > 0 && nextBitmap && next) {
        ctx.globalAlpha = opacity
        drawShot(ctx, nextBitmap, next.transform, frame, {
          width: next.width,
          height: next.height,
        })
        ctx.globalAlpha = 1
      }
    } catch {
      // Ignoré : voir le commentaire ci-dessus.
    }
  }, [currentBitmap, nextBitmap, opacity, current, next, frame])

  function updateFrom(clientX: number) {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
    setPosition(ratio * (shots.length - 1))
  }

  const caption = hasNext && next
    ? `${formatDate(current.takenAt)} → ${formatDate(next.takenAt)}`
    : formatDate(current.takenAt)

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div
        ref={containerRef}
        data-testid="series-scrubber"
        className="relative min-h-0 flex-1 touch-none overflow-hidden rounded-xl bg-black"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          updateFrom(event.clientX)
        }}
        onPointerMove={(event) => {
          if (event.buttons === 0) return
          updateFrom(event.clientX)
        }}
      >
        <canvas
          ref={canvasRef}
          width={frame.width}
          height={frame.height}
          className="h-full w-full object-contain"
        />
      </div>
      <input
        type="range"
        data-testid="series-scrubber-input"
        aria-label="Position dans la série"
        min={0}
        max={shots.length - 1}
        step={0.01}
        value={clamped}
        onChange={(event) => setPosition(Number(event.target.value))}
        className="w-full"
      />
      <p className="shrink-0 text-center text-xs text-slate-500">{caption}</p>
    </div>
  )
}
