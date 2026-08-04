import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { getShot } from '@/db/shots'
import { getViewpoint } from '@/db/viewpoints'
import { useBitmap } from '@/hooks/useBitmap'
import { formatDate } from '@/lib/format'
import { renderCrossfadeGif } from '@/render/gif'
import { renderSideBySide, type ComparisonInput } from '@/render/sideBySide'
import { shareOrDownload } from '@/share/shareOrDownload'
import type { Shot, Size, Viewpoint } from '@/types'
import { RevealSlider } from './components/RevealSlider'
import { Screen } from './components/Screen'
import { ShotCanvas } from './components/ShotCanvas'

/** Réduit un nom libre à un fragment de nom de fichier sûr. */
function slugify(value: string): string {
  return value
    .normalize('NFD')
    // Les diacritiques décomposés, à retirer avant de filtrer sur [a-z0-9].
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'comparaison'
}

function fileStamp(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function CompareScreen() {
  const { id } = useParams<{ id: string }>()
  const [params] = useSearchParams()

  const [viewpoint, setViewpoint] = useState<Viewpoint | null>(null)
  const [pair, setPair] = useState<{ before: Shot; after: Shot } | null>(null)
  const [status, setStatus] = useState<string | null>('Chargement…')
  const [showDates, setShowDates] = useState(true)
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState<null | 'jpeg' | 'gif'>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Annuler l encodage si l utilisateur quitte l écran : sans ça le worker
  // continuerait de tourner pour un fichier que plus personne n attend.
  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (!id) return
    const beforeId = params.get('before')
    const afterId = params.get('after')

    Promise.all([
      getViewpoint(id),
      beforeId ? getShot(beforeId) : undefined,
      afterId ? getShot(afterId) : undefined,
    ]).then(([foundViewpoint, before, after]) => {
      if (!foundViewpoint || !before || !after) {
        setStatus('Comparaison introuvable. Retournez à la série pour en choisir une autre.')
        return
      }
      setViewpoint(foundViewpoint)
      setPair({ before, after })
      setStatus(null)
    }).catch(() => setStatus('Impossible de lire cette comparaison.'))
  }, [id, params])

  const beforeBitmap = useBitmap(pair?.before.blob)
  const afterBitmap = useBitmap(pair?.after.blob)

  const frame: Size | null = viewpoint
    ? { width: viewpoint.frameWidth, height: viewpoint.frameHeight }
    : null

  // Les boutons d export restent inertes tant que les deux photos ne sont pas
  // décodées : les activer plus tôt donnerait une tape sans effet ni message.
  const ready = Boolean(pair && frame && beforeBitmap && afterBitmap)

  function inputsFor(): { before: ComparisonInput; after: ComparisonInput } | null {
    if (!pair || !beforeBitmap || !afterBitmap) return null
    return {
      before: {
        source: beforeBitmap,
        transform: pair.before.transform,
        takenAt: pair.before.takenAt,
        shot: { width: pair.before.width, height: pair.before.height },
      },
      after: {
        source: afterBitmap,
        transform: pair.after.transform,
        takenAt: pair.after.takenAt,
        shot: { width: pair.after.width, height: pair.after.height },
      },
    }
  }

  async function exportJpeg() {
    const inputs = inputsFor()
    // `busy` verrouille les deux boutons : sans lui, une double tape ou une tape sur
    // l autre export lancerait un second travail concurrent, donc deux partages.
    if (!inputs || !frame || !viewpoint || !pair || busy) return
    setBusy('jpeg')
    setStatus("Génération de l'image…")
    try {
      const blob = await renderSideBySide(inputs.before, inputs.after, frame, { showDates })
      const name = `b4after-${slugify(viewpoint.name)}-${fileStamp(pair.after.takenAt)}.jpg`
      const outcome = await shareOrDownload(new File([blob], name, { type: 'image/jpeg' }))
      setStatus(outcome === 'downloaded' ? 'Image téléchargée.' : null)
    } catch {
      setStatus("La génération de l'image a échoué.")
    } finally {
      setBusy(null)
    }
  }

  async function exportGif() {
    const inputs = inputsFor()
    if (!inputs || !frame || !viewpoint || !pair || busy) return
    const controller = new AbortController()
    abortRef.current = controller
    setBusy('gif')
    setStatus(null)
    setProgress(0)
    try {
      const blob = await renderCrossfadeGif(inputs.before, inputs.after, frame, {
        onProgress: (done, total) => setProgress(done / total),
        signal: controller.signal,
      })
      const name = `b4after-${slugify(viewpoint.name)}-${fileStamp(pair.after.takenAt)}.gif`
      const outcome = await shareOrDownload(new File([blob], name, { type: 'image/gif' }))
      setStatus(outcome === 'downloaded' ? 'GIF téléchargé.' : null)
    } catch (caught) {
      setStatus(
        caught instanceof DOMException && caught.name === 'AbortError'
          ? 'Export annulé.'
          : 'La génération du GIF a échoué.',
      )
    } finally {
      abortRef.current = null
      setProgress(null)
      setBusy(null)
    }
  }

  return (
    <Screen
      title="Comparaison"
      back={
        <Link to={`/v/${id}`} className="text-sm text-slate-300">
          Retour
        </Link>
      }
    >
      <div className="space-y-4 p-4">
        {pair && frame && (
          <>
            <div style={{ aspectRatio: `${frame.width} / ${frame.height}` }}>
              <RevealSlider
                before={
                  <ShotCanvas
                    source={beforeBitmap}
                    transform={pair.before.transform}
                    frame={frame}
                    shot={{ width: pair.before.width, height: pair.before.height }}
                    className="h-full w-full"
                  />
                }
                after={
                  <ShotCanvas
                    source={afterBitmap}
                    transform={pair.after.transform}
                    frame={frame}
                    shot={{ width: pair.after.width, height: pair.after.height }}
                    className="h-full w-full"
                  />
                }
              />
            </div>

            <p className="text-center text-sm text-slate-400">
              {formatDate(pair.before.takenAt)} → {formatDate(pair.after.takenAt)}
            </p>

            <label className="flex items-center gap-3 text-sm text-slate-200">
              <input
                type="checkbox"
                data-testid="toggle-dates"
                checked={showDates}
                onChange={(event) => setShowDates(event.target.checked)}
              />
              Afficher les dates sur l'image côte-à-côte
            </label>

            {!ready && (
              <p className="text-center text-sm text-slate-400">Préparation des photos…</p>
            )}

            <button
              type="button"
              data-testid="export-jpeg"
              disabled={!ready || busy !== null}
              onClick={exportJpeg}
              className="w-full rounded-xl bg-sky-500 py-4 font-semibold text-slate-950 disabled:opacity-40"
            >
              Image côte-à-côte
            </button>
            <button
              type="button"
              data-testid="export-gif"
              disabled={!ready || busy !== null}
              onClick={exportGif}
              className="w-full rounded-xl border border-slate-600 py-4 disabled:opacity-40"
            >
              GIF animé
            </button>

            {progress !== null && (
              <div data-testid="export-progress" className="space-y-1">
                <div className="h-2 overflow-hidden rounded-full bg-slate-700">
                  <div
                    className="h-full bg-sky-400 transition-[width]"
                    style={{ width: `${Math.round(progress * 100)}%` }}
                  />
                </div>
                <p className="text-center text-xs text-slate-400">
                  Encodage du GIF… {Math.round(progress * 100)} %
                </p>
                <button
                  type="button"
                  data-testid="cancel-export"
                  onClick={() => abortRef.current?.abort()}
                  className="w-full py-2 text-sm text-slate-300 underline"
                >
                  Annuler l'export
                </button>
              </div>
            )}
          </>
        )}

        {status && (
          <p data-testid="export-status" className="text-center text-sm text-slate-300">
            {status}
          </p>
        )}
      </div>
    </Screen>
  )
}
