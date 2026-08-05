import { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { IDENTITY } from '@/align/transform'
import { useCamera, type CapturedFrame } from '@/camera/useCamera'
import { isQuotaError } from '@/db/storage'
import { createViewpointWithFirstShot, nextViewpointName } from '@/db/viewpoints'
import { BusyStatus } from './components/BusyStatus'
import { CameraDeniedNotice } from './components/CameraDeniedNotice'
import { Screen } from './components/Screen'
import { ShotCanvas } from './components/ShotCanvas'

/** Étapes visibles de l enregistrement : l encodage peut ne pas être fini à la tape. */
type SaveStage = 'idle' | 'encoding' | 'saving'

const STAGE_LABEL: Record<Exclude<SaveStage, 'idle'>, string> = {
  encoding: 'Encodage de la photo…',
  saving: 'Enregistrement…',
}

/** Capture de la première photo d un point de vue : elle définit le cadre canonique. */
export function FirstCaptureScreen() {
  const navigate = useNavigate()
  const [captured, setCaptured] = useState<CapturedFrame | null>(null)
  const [name, setName] = useState('')
  const [stage, setStage] = useState<SaveStage>('idle')
  const [error, setError] = useState<string | null>(null)
  const writingRef = useRef(false)

  function onCaptured(frame: CapturedFrame) {
    setCaptured(frame)
    // Le nom par défaut demande une lecture en base : il arrive après l affichage de la
    // photo, jamais avant. Rien de ce qui touche au stockage ne retarde l aperçu.
    nextViewpointName()
      .then(setName)
      .catch(() => setName(''))
  }

  async function onConfirm() {
    // Garde synchrone : le remplacement du bouton par le libellé d étape ne prend effet
    // qu au rendu suivant, donc deux tapes rapprochées pourraient toutes deux entrer ici.
    if (writingRef.current || !captured) return
    writingRef.current = true
    setError(null)

    // Le plus souvent l encodage est déjà fini — l utilisateur a pris le temps de saisir
    // un nom — et on passe directement à « Enregistrement… ».
    setStage(captured.encoding.isDone() ? 'saving' : 'encoding')

    let encoded
    try {
      encoded = await captured.encoding.result()
    } catch {
      // La photo reste affichée et l encodage est réessayable : un nouvel appui repart
      // d un encodage neuf plutôt que de buter sur le même échec.
      writingRef.current = false
      setStage('idle')
      setError("La photo n'a pas pu être préparée. Réessayez.")
      return
    }

    setStage('saving')
    try {
      // Une seule transaction : un échec ne doit pas laisser un point de vue sans
      // photo dans la liste, ni chaque nouvelle tentative en créer un de plus.
      await createViewpointWithFirstShot({
        name: name.trim() || (await nextViewpointName()),
        width: captured.width,
        height: captured.height,
        blob: encoded.blob,
        thumbBlob: encoded.thumbBlob,
      })
      navigate('/', { replace: true })
    } catch (caught) {
      writingRef.current = false
      setStage('idle')
      setError(
        isQuotaError(caught)
          ? "L'espace de stockage est plein. Supprimez d'anciennes photos, puis réessayez — celle-ci n'est pas perdue."
          : "L'enregistrement a échoué. Réessayez.",
      )
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
      {captured ? (
        <div className="relative h-full">
          {/* Le canvas saisi se dessine tel quel : ni encodage ni décodage entre la tape
              et l affichage. */}
          <ShotCanvas
            data-testid="captured-preview"
            source={captured.source}
            transform={IDENTITY}
            frame={{ width: captured.width, height: captured.height }}
            shot={{ width: captured.width, height: captured.height }}
            className="h-full w-full bg-black object-contain"
          />

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
            {stage === 'idle' ? (
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
                  onClick={onConfirm}
                  className="flex-1 rounded-xl bg-sky-500 py-3 font-semibold text-slate-950"
                >
                  Enregistrer
                </button>
              </div>
            ) : (
              <BusyStatus label={STAGE_LABEL[stage]} />
            )}
          </div>

          {error && (
            <p className="absolute inset-x-4 top-4 rounded-lg bg-red-900/90 p-3 text-sm">
              {error}
            </p>
          )}
        </div>
      ) : (
        <CaptureStage onCaptured={onCaptured} />
      )}
    </Screen>
  )
}

/**
 * Seule propriétaire du flux caméra tant qu aucune photo n a été prise : son
 * démontage, quand le parent bascule sur l aperçu, déclenche le nettoyage de
 * `useCamera` et coupe réellement la piste — pas seulement son affichage.
 */
function CaptureStage({ onCaptured }: { onCaptured: (frame: CapturedFrame) => void }) {
  const { videoRef, status, retry, capture } = useCamera({})
  const [error, setError] = useState<string | null>(null)

  // Synchrone de bout en bout : plus d état « occupé » à gérer, la photo est saisie et
  // affichée dans le même tour.
  function onShutter() {
    setError(null)
    try {
      onCaptured(capture())
    } catch {
      setError('La capture a échoué. Réessayez.')
    }
  }

  if (status === 'denied' || status === 'unavailable') {
    return <CameraDeniedNotice status={status} onRetry={retry} />
  }

  return (
    <div className="relative h-full">
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        className="h-full w-full bg-black object-contain"
      />

      <button
        type="button"
        data-testid="shutter"
        disabled={status !== 'ready'}
        onClick={onShutter}
        className="absolute bottom-6 left-1/2 size-20 -translate-x-1/2 rounded-full border-4 border-white bg-white/30 disabled:opacity-40"
        aria-label="Prendre la photo"
      />

      {error && (
        <p className="absolute inset-x-4 top-4 rounded-lg bg-red-900/90 p-3 text-sm">{error}</p>
      )}
    </div>
  )
}
