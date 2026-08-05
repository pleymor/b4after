import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { useCamera } from '@/camera/useCamera'
import { setPendingShot } from '@/capture/pendingShot'
import { getViewpoint } from '@/db/viewpoints'
import { useBitmap } from '@/hooks/useBitmap'
import { useShots } from '@/hooks/useShots'
import { needsRotationHint } from '@/lib/orientation'
import type { Shot, Size, Viewpoint } from '@/types'
import { CameraDeniedNotice } from './components/CameraDeniedNotice'
import { OpacitySlider } from './components/OpacitySlider'
import { Screen } from './components/Screen'
import { ShotCanvas } from './components/ShotCanvas'

type LoadState =
  | { status: 'loading' }
  | { status: 'found'; viewpoint: Viewpoint }
  | { status: 'not-found' }
  | { status: 'error' }

/**
 * Reprise d un point de vue existant. `viewpointId` arrive en prop, jamais
 * `undefined` : impossible par construction de retomber dans le flux « première
 * photo » faute de cadre résolu.
 *
 * Charge le point de vue avant de rendre quoi que ce soit d autre : tant que le
 * cadre canonique n est pas connu, la caméra n est pas montée, ce qui évite une
 * première ouverture avec un `aspectRatio` indéfini suivie d une seconde une fois le
 * point de vue chargé.
 */
export function RetakeCaptureScreen({ viewpointId }: { viewpointId: string }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  useEffect(() => {
    let active = true
    setState({ status: 'loading' })
    getViewpoint(viewpointId)
      .then((found) => {
        if (!active) return
        setState(found ? { status: 'found', viewpoint: found } : { status: 'not-found' })
      })
      .catch(() => {
        // Sans ce filet, un rejet laisserait l écran bloqué sur « Chargement… » pour
        // toujours, sans jamais dire à l utilisateur ce qui ne va pas.
        if (!active) return
        setState({ status: 'error' })
      })
    return () => {
      active = false
    }
  }, [viewpointId])

  if (state.status === 'not-found') {
    return (
      <Screen
        title="Reprise"
        back={
          <Link to="/" className="text-sm text-slate-300">
            Annuler
          </Link>
        }
      >
        <div className="px-6 py-12 text-center text-slate-300">
          <p className="text-lg font-medium">Ce point de vue n'existe plus.</p>
          <Link
            to="/"
            className="mt-6 inline-block rounded-xl bg-sky-500 px-6 py-3 font-semibold text-slate-950"
          >
            Retour à l'accueil
          </Link>
        </div>
      </Screen>
    )
  }

  if (state.status === 'error') {
    return (
      <Screen
        title="Reprise"
        back={
          <Link to={`/v/${viewpointId}`} className="text-sm text-slate-300">
            Annuler
          </Link>
        }
      >
        <div className="px-6 py-12 text-center text-slate-300">
          <p className="text-lg font-medium">Impossible de charger ce point de vue.</p>
          <Link
            to={`/v/${viewpointId}`}
            className="mt-6 inline-block rounded-xl bg-sky-500 px-6 py-3 font-semibold text-slate-950"
          >
            Retour
          </Link>
        </div>
      </Screen>
    )
  }

  if (state.status === 'loading') {
    return (
      <Screen
        title="Reprise"
        back={
          <Link to={`/v/${viewpointId}`} className="text-sm text-slate-300">
            Annuler
          </Link>
        }
      >
        <div className="px-6 py-12 text-center text-slate-300">Chargement…</div>
      </Screen>
    )
  }

  return (
    <RetakeCapture
      viewpointId={viewpointId}
      viewpoint={state.viewpoint}
      frame={{ width: state.viewpoint.frameWidth, height: state.viewpoint.frameHeight }}
    />
  )
}

/**
 * Ne se monte qu une fois le cadre canonique connu : `frame` est donc déjà défini au
 * premier rendu, et l effet de `useCamera` ne se rejoue pas au chargement du point
 * de vue.
 */
function RetakeCapture({
  viewpointId,
  viewpoint,
  frame,
}: {
  viewpointId: string
  viewpoint: Viewpoint
  frame: Size
}) {
  const navigate = useNavigate()

  const { shots } = useShots(viewpointId)
  const reference: Shot | undefined = shots.at(-1)
  const { bitmap: referenceBitmap } = useBitmap(reference?.blob)

  const { videoRef, status, retry, capture } = useCamera({
    aspectRatio: frame.width / frame.height,
  })

  const [ghostOpacity, setGhostOpacity] = useState(0.5)
  const [rotationHint, setRotationHint] = useState(false)

  useEffect(() => {
    const update = () =>
      setRotationHint(
        needsRotationHint({ width: window.innerWidth, height: window.innerHeight }, frame),
      )
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
    // Dépendances primitives : `frame` est un objet recréé à chaque rendu.
  }, [frame.width, frame.height])

  const [error, setError] = useState<string | null>(null)

  /**
   * Aucun `await` entre la tape et la navigation : l écran de calage s ouvre sur la photo
   * saisie pendant que son encodage tourne encore en arrière-plan. C est ce qui supprime
   * les secondes d écran figé qu on avait à attendre le JPEG.
   */
  function onShutter() {
    setError(null)
    try {
      const captured = capture()
      // Rien n est écrit en base : la photo ne rejoint la série qu après validation
      // du calage.
      setPendingShot({ viewpointId, frame, captured })
      navigate(`/v/${viewpointId}/align`)
    } catch {
      setError('La capture a échoué. Réessayez.')
    }
  }

  return (
    <Screen
      title={viewpoint.name}
      back={
        <Link to={`/v/${viewpointId}`} className="text-sm text-slate-300">
          Annuler
        </Link>
      }
    >
      {status === 'denied' || status === 'unavailable' ? (
        <CameraDeniedNotice status={status} onRetry={retry} />
      ) : (
        <div className="relative flex h-full items-center justify-center overflow-hidden">
          {/* Le flux et le fantôme doivent occuper exactement la même boîte, au rapport
              d aspect du cadre canonique. Sinon le flux se letterboxe au rapport du
              capteur et le fantôme à celui du cadre : les deux calques n ont plus ni la
              même échelle ni le même centre, et l aide au cadrage induit en erreur.
              `object-cover` sur la vidéo montre précisément le recadrage que le cadre
              canonique appliquera à la prise. La hauteur est définie et la largeur
              dérivée du rapport, pour que la boîte le respecte exactement. */}
          <div
            className="relative h-full w-auto shrink-0"
            style={{ aspectRatio: `${frame.width} / ${frame.height}` }}
          >
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="absolute inset-0 h-full w-full bg-black object-cover"
            />

            <ShotCanvas
              data-testid="ghost"
              source={referenceBitmap}
              transform={reference?.transform ?? { scale: 1, rotation: 0, tx: 0, ty: 0 }}
              frame={frame}
              shot={{
                width: reference?.width ?? frame.width,
                height: reference?.height ?? frame.height,
              }}
              className="pointer-events-none absolute inset-0 h-full w-full"
              style={{ opacity: ghostOpacity }}
            />
          </div>

          {rotationHint && (
            <p
              data-testid="rotation-hint"
              className="absolute inset-x-4 top-4 rounded-lg bg-amber-900/90 p-3 text-sm"
            >
              Tournez le téléphone pour retrouver le cadrage d'origine.
            </p>
          )}

          <div className="absolute inset-x-4 bottom-28 rounded-xl bg-slate-900/80 p-3">
            <OpacitySlider value={ghostOpacity} onChange={setGhostOpacity} />
          </div>

          <button
            type="button"
            data-testid="shutter"
            disabled={status !== 'ready'}
            onClick={onShutter}
            className="absolute bottom-6 left-1/2 size-20 -translate-x-1/2 rounded-full border-4 border-white bg-white/30 disabled:opacity-40"
            aria-label="Prendre la photo"
          />

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
