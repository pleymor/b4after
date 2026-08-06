import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { getViewpoint } from '@/db/viewpoints'
import { useExportOptions } from '@/hooks/useExportOptions'
import { useObjectUrl } from '@/hooks/useObjectUrl'
import { useShots } from '@/hooks/useShots'
import {
  STAMP_SCALE_MAX,
  STAMP_SCALE_MIN,
  type HoldDuration,
  type ImageWidth,
  type Layout,
  type Pace,
  type StampMode,
  type Transition,
  type VideoWidth,
} from '@/lib/exportOptions'
import { renderCrossfadeGif } from '@/render/gif'
import { renderSideBySide, type ComparisonInput } from '@/render/sideBySide'
import { renderCrossfadeVideo, supportedVideoMime } from '@/render/video'
import { shareOrDownload } from '@/share/shareOrDownload'
import type { Shot, Size, Viewpoint } from '@/types'
import { OptionRow } from './components/OptionRow'
import { Screen } from './components/Screen'
import { SeriesScrubber } from './components/SeriesScrubber'
import { Sheet } from './components/Sheet'
import { PlayIcon, SideBySideIcon } from './components/icons'

const STAMP_LABELS: readonly { value: StampMode; label: string }[] = [
  { value: 'none', label: 'Aucun' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date + heure' },
]

const LAYOUT_LABELS: readonly { value: Layout; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'horizontal', label: 'Horizontal' },
  { value: 'vertical', label: 'Vertical' },
]

const TRANSITION_LABELS: readonly { value: Transition; label: string }[] = [
  { value: 'crossfade', label: 'Fondu' },
  { value: 'cut', label: 'Coupe' },
  { value: 'wipe', label: 'Balayage' },
]

const VIDEO_WIDTH_LABELS: readonly { value: VideoWidth; label: string }[] = [
  { value: 640, label: 'Standard' },
  { value: 1080, label: 'Haute' },
  { value: 'full', label: 'Maximale' },
]

const HOLD_LABELS: readonly { value: HoldDuration; label: string }[] = [
  { value: 'short', label: 'Courte' },
  { value: 'medium', label: 'Moyenne' },
  { value: 'long', label: 'Longue' },
]

// Pendant exact de VIDEO_WIDTH_LABELS pour l image : mêmes libellés, valeurs propres
// à `ImageWidth` (voir la spec de comparaison de série).
const IMAGE_WIDTH_LABELS: readonly { value: ImageWidth; label: string }[] = [
  { value: 1024, label: 'Standard' },
  { value: 2048, label: 'Haute' },
  { value: 'full', label: 'Maximale' },
]

const PACE_LABELS: readonly { value: Pace; label: string }[] = [
  { value: 'slow', label: 'Lent' },
  { value: 'normal', label: 'Normal' },
  { value: 'fast', label: 'Rapide' },
]

/**
 * Largeur maximale de l aperçu, bien sous les plafonds de l option « Largeur » : le
 * bandeau et la police étant proportionnels à la largeur de cellule, un rendu à cette
 * taille est exactement l export en plus petit — jamais une approximation à part.
 */
const PREVIEW_MAX_EDGE = 480

/**
 * Temporisation avant de recalculer l aperçu. Un curseur continu émet des dizaines
 * d événements par glissement, et chacun déclenche un encodage JPEG complet : sans
 * ce délai, on réencoderait à chaque pixel parcouru par le doigt.
 */
const PREVIEW_DEBOUNCE_MS = 150

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

function toComparisonInput(shot: Shot): ComparisonInput {
  return {
    blob: shot.blob,
    transform: shot.transform,
    takenAt: shot.takenAt,
    shot: { width: shot.width, height: shot.height },
  }
}

export function CompareScreen() {
  const { id } = useParams<{ id: string }>()

  const [viewpoint, setViewpoint] = useState<Viewpoint | null>(null)
  const { shots, loading: shotsLoading, error: shotsError } = useShots(id)
  const [status, setStatus] = useState<string | null>('Chargement…')
  // Distingue l échec (alerte) du succès et de l information neutre : les trois
  // partagent la même zone de statut, sans quoi rien ne les distinguerait à l œil.
  const [statusError, setStatusError] = useState(false)
  const [options, updateOptions] = useExportOptions()
  const [sheet, setSheet] = useState<null | 'image' | 'video'>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [busy, setBusy] = useState<null | 'jpeg' | 'anim'>(null)
  const abortRef = useRef<AbortController | null>(null)

  // Annuler l encodage si l utilisateur quitte l écran : sans ça le worker
  // continuerait de tourner pour un fichier que plus personne n attend.
  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    if (!id) return
    getViewpoint(id)
      .then((found) => {
        if (!found) {
          setStatus('Comparaison introuvable. Retournez à la série pour en choisir une autre.')
          return
        }
        setViewpoint(found)
      })
      .catch(() => setStatus('Impossible de lire cette comparaison.'))
  }, [id])

  /** Pose le statut affiché dans le pied de page, avec sa couleur (alerte ou neutre). */
  function setFooterStatus(message: string | null, error = false) {
    setStatus(message)
    setStatusError(error)
  }

  // La comparaison porte sur toute la série : moins de deux photos, et il n y a rien à
  // comparer — le même garde-fou que le bouton « Comparer » de l écran de détail, ici
  // recontrôlé au cas où l URL a été atteinte directement.
  useEffect(() => {
    if (shotsLoading) return
    if (shotsError) {
      setFooterStatus('Impossible de lire cette comparaison.', true)
      return
    }
    if (shots.length < 2) {
      setFooterStatus('Comparaison introuvable. Retournez à la série pour en choisir une autre.')
      return
    }
    setFooterStatus(null)
  }, [shotsLoading, shotsError, shots.length])

  const frame: Size | null = viewpoint
    ? { width: viewpoint.frameWidth, height: viewpoint.frameHeight }
    : null

  const ready = Boolean(viewpoint && frame && !shotsLoading && !shotsError && shots.length >= 2)

  // Choisi une fois pour l écran : sert à masquer le réglage de durée, qui ne
  // s applique pas au repli GIF.
  const videoSupported = supportedVideoMime() !== null

  // Fermer la feuille pendant un encodage ferait disparaître d un coup la progression
  // et le bouton d annulation, sans aucun moyen de les retrouver : seul le bouton
  // « Annuler l export », qui reste visible, doit alors pouvoir interrompre. Une fois
  // l encodage terminé (succès, échec ou annulation), la feuille se ferme d elle-même
  // ailleurs, ce qui ne passe pas par cette fonction.
  function closeSheet() {
    if (busy === 'anim') return
    setSheet(null)
  }

  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const previewUrl = useObjectUrl(previewBlob)

  // Aperçu réel de l export : même fonction, même chemin de code, juste une largeur
  // maximale réduite — c est ce qui garantit que l aperçu et l export ne peuvent pas
  // diverger. Temporisé pour ne pas réencoder à chaque pixel parcouru par le curseur.
  useEffect(() => {
    if (sheet !== 'image' || !ready || !frame) return

    let cancelled = false
    const timer = setTimeout(() => {
      renderSideBySide(shots.map(toComparisonInput), frame, options.image, PREVIEW_MAX_EDGE)
        .then((blob) => {
          if (!cancelled) setPreviewBlob(blob)
        })
        .catch(() => {
          // Un aperçu manqué reste sans conséquence : l export, lui, resterait signalé
          // par son propre message d échec.
          if (!cancelled) setPreviewBlob(null)
        })
    }, PREVIEW_DEBOUNCE_MS)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [sheet, ready, shots, frame, options.image])

  async function exportJpeg() {
    if (!ready || !frame || !viewpoint || busy) return
    setBusy('jpeg')
    setFooterStatus("Génération de l'image…")
    try {
      const blob = await renderSideBySide(shots.map(toComparisonInput), frame, options.image)
      const name = `b4after-${slugify(viewpoint.name)}-${fileStamp(shots.at(-1)!.takenAt)}.jpg`
      const outcome = await shareOrDownload(new File([blob], name, { type: 'image/jpeg' }))
      setFooterStatus(outcome === 'downloaded' ? 'Image téléchargée.' : null)
    } catch {
      setFooterStatus("La génération de l'image a échoué.", true)
    } finally {
      // Dans le `finally`, et non plus seulement sur le chemin heureux : sinon le
      // message d échec ou d annulation reste rendu sous la feuille encore ouverte,
      // recouverte et donc invisible.
      setSheet(null)
      setBusy(null)
    }
  }

  async function exportAnimation() {
    if (!ready || !frame || !viewpoint || busy) return
    const inputs = shots.map(toComparisonInput)
    const controller = new AbortController()
    abortRef.current = controller
    // Choisi une seule fois par export : MediaRecorder ne change pas de format en
    // cours de route, et refaire l appel à mi-parcours ne servirait à rien.
    const mime = supportedVideoMime()
    setBusy('anim')
    setFooterStatus(null)
    setProgress(0)
    try {
      const blob = mime
        ? await renderCrossfadeVideo(inputs, frame, {
            ...options.video,
            onProgress: (done: number, total: number) => setProgress(done / total),
            signal: controller.signal,
          })
        : await renderCrossfadeGif(inputs, frame, {
            transition: options.video.transition,
            width: options.video.width,
            onProgress: (done: number, total: number) => setProgress(done / total),
            signal: controller.signal,
          })
      const ext = mime ? 'mp4' : 'gif'
      const name = `b4after-${slugify(viewpoint.name)}-${fileStamp(shots.at(-1)!.takenAt)}.${ext}`
      const outcome = await shareOrDownload(new File([blob], name, { type: mime ?? 'image/gif' }))
      setFooterStatus(outcome === 'downloaded' ? 'Export téléchargé.' : null)
    } catch (caught) {
      // L annulation est un choix de l utilisateur, pas un échec : elle reste dans la
      // couleur neutre. Seul un échec réel prend la couleur d alerte.
      const cancelled = caught instanceof DOMException && caught.name === 'AbortError'
      setFooterStatus(
        cancelled ? 'Export annulé.' : "La génération de l'export animé a échoué.",
        !cancelled,
      )
    } finally {
      abortRef.current = null
      setProgress(null)
      setBusy(null)
      // Dans le `finally`, et non plus seulement sur le chemin heureux : sinon le
      // message d échec ou d annulation reste rendu sous la feuille encore ouverte,
      // recouverte et donc invisible.
      setSheet(null)
    }
  }

  const exportProgress = progress !== null && (
    <div data-testid="export-progress" className="space-y-1">
      <div className="h-2 overflow-hidden rounded-full bg-slate-700">
        <div
          className="h-full bg-sky-400 transition-[width]"
          style={{ width: `${Math.round(progress * 100)}%` }}
        />
      </div>
      <p className="text-center text-xs text-slate-400">
        Encodage de l'export animé… {Math.round(progress * 100)} %
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
  )

  return (
    <Screen
      title="Comparaison"
      back={
        <Link to={`/v/${id}`} className="text-sm text-slate-300">
          Retour
        </Link>
      }
      footer={
        ready && (
          <div className="p-2">
            {status && (
              <p
                data-testid="export-status"
                className={`pb-2 text-center text-sm ${statusError ? 'text-rose-300' : 'text-slate-300'}`}
              >
                {status}
              </p>
            )}
            <div className="flex justify-center gap-8">
              <ExportBarButton
                testId="open-image-options"
                label="Image"
                icon={<SideBySideIcon />}
                disabled={!ready || busy !== null}
                onClick={() => setSheet('image')}
              />
              <ExportBarButton
                testId="open-video-options"
                label="Vidéo"
                icon={<PlayIcon />}
                disabled={!ready || busy !== null}
                onClick={() => setSheet('video')}
              />
            </div>
          </div>
        )
      }
    >
      <div className="flex h-full flex-col gap-4 p-4">
        {ready && frame && (
          <div className="flex min-h-0 flex-1">
            <SeriesScrubber shots={shots} frame={frame} />
          </div>
        )}

        {/* Hors du bloc `ready` : c est ici que s affiche « Comparaison introuvable ».
            Le statut de la barre du bas, lui, n existe que quand la série est prête. */}
        {!ready && status && (
          <p data-testid="export-status" className="text-center text-sm text-slate-300">
            {status}
          </p>
        )}
      </div>

      <Sheet title="Image côte-à-côte" open={sheet === 'image'} onClose={closeSheet}>
        {/* Hauteur plafonnée : sans ça, un cadre très allongé chasserait les réglages
            et le bouton d export hors de l écran visible de la feuille. */}
        <div className="flex max-h-48 justify-center overflow-hidden rounded-lg bg-slate-950/40 p-2">
          {previewUrl ? (
            <img
              data-testid="image-preview"
              src={previewUrl}
              alt="Aperçu de l'export image côte-à-côte"
              className="max-h-44 w-auto object-contain"
            />
          ) : (
            <p className="self-center p-6 text-center text-sm text-slate-400">
              Préparation de l'aperçu…
            </p>
          )}
        </div>
        <OptionRow
          testId="stamp-mode"
          label="Dates sur l'image"
          value={options.image.stamp}
          options={STAMP_LABELS}
          onChange={(stamp) => updateOptions({ image: { stamp } })}
        />
        <OptionRow
          testId="layout-mode"
          label="Disposition"
          value={options.image.layout}
          options={LAYOUT_LABELS}
          onChange={(layout) => updateOptions({ image: { layout } })}
        />
        <OptionRow
          testId="image-width"
          label="Largeur"
          value={options.image.width}
          options={IMAGE_WIDTH_LABELS}
          onChange={(width) => updateOptions({ image: { width } })}
        />
        <div className="space-y-2">
          <label htmlFor="stamp-scale" className="text-sm text-slate-300">
            Taille du bandeau
          </label>
          {/* Curseur continu, et non des tailles prédéfinies : c est précisément un
              réglage qui se juge à l œil, pas dans une liste d options. Désactivé sans
              bandeau (`stamp` à « Aucun ») : il n y a alors rien à dimensionner. */}
          <input
            id="stamp-scale"
            type="range"
            data-testid="stamp-scale"
            min={STAMP_SCALE_MIN}
            max={STAMP_SCALE_MAX}
            step={0.1}
            value={options.image.stampScale}
            disabled={options.image.stamp === 'none'}
            onChange={(event) =>
              updateOptions({ image: { stampScale: Number(event.target.value) } })
            }
            className="w-full disabled:opacity-40"
          />
        </div>
        <button
          type="button"
          data-testid="export-jpeg"
          disabled={!ready || busy !== null}
          onClick={exportJpeg}
          className="w-full rounded-xl bg-sky-500 py-4 font-semibold text-slate-950 disabled:opacity-40"
        >
          Exporter l'image
        </button>
      </Sheet>

      <Sheet title="Vidéo animée" open={sheet === 'video'} onClose={closeSheet}>
        <OptionRow
          testId="transition-mode"
          label="Transition"
          value={options.video.transition}
          options={TRANSITION_LABELS}
          onChange={(transition) => updateOptions({ video: { transition } })}
        />
        <OptionRow
          testId="video-width"
          label="Qualité"
          value={options.video.width}
          options={VIDEO_WIDTH_LABELS}
          onChange={(width) => updateOptions({ video: { width } })}
        />
        {/* La durée d affichage ne s applique pas au repli GIF : il boucle à l infini
            en paliers fixes, ce réglage y resterait sans effet. On ne montre donc pas
            une ligne qui n aurait aucune prise sur ce navigateur. */}
        {videoSupported && (
          <OptionRow
            testId="video-hold"
            label="Durée des photos"
            value={options.video.hold}
            options={HOLD_LABELS}
            onChange={(hold) => updateOptions({ video: { hold } })}
          />
        )}
        {/* Comme la durée ci-dessus : le rythme n a aucun effet sur le repli GIF, qui
            garde son propre modèle en paliers (voir video.ts et gif.ts). Et comme le
            curseur de taille du bandeau sans bandeau : une coupe franche n a pas de
            fondu à accélérer ou ralentir (voir le commentaire sur `fadeMs` dans
            video.ts), le réglage reste donc désactivé plutôt que de mimer un effet
            qu il n a pas. */}
        {videoSupported && (
          <OptionRow
            testId="video-pace"
            label="Rythme"
            value={options.video.pace}
            options={PACE_LABELS}
            onChange={(pace) => updateOptions({ video: { pace } })}
            disabled={options.video.transition === 'cut'}
          />
        )}
        {/* data-testid historique : il datait de l export GIF que celui-ci remplace en
            priorité (avec repli sur GIF si la vidéo n est pas prise en charge). Le
            renommer serait un remue-ménage pour rien, les tests le ciblent déjà. */}
        <button
          type="button"
          data-testid="export-gif"
          disabled={!ready || busy !== null}
          onClick={exportAnimation}
          className="w-full rounded-xl border border-slate-600 py-4 disabled:opacity-40"
        >
          Exporter la vidéo
        </button>
        {exportProgress}
      </Sheet>
    </Screen>
  )
}

function ExportBarButton({
  testId,
  label,
  icon,
  disabled,
  onClick,
}: {
  testId: string
  label: string
  icon: React.ReactNode
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      disabled={disabled}
      onClick={onClick}
      className="flex flex-col items-center gap-1 px-4 py-1 text-slate-200 disabled:opacity-40"
    >
      {icon}
      <span className="text-[10px]">{label}</span>
    </button>
  )
}
