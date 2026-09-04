import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { clampToCover } from '@/align/transform'
import { updateShotTransform } from '@/db/shots'
import { getViewpoint } from '@/db/viewpoints'
import { useBitmap } from '@/hooks/useBitmap'
import { useShots } from '@/hooks/useShots'
import type { Shot, Size } from '@/types'
import { AlignSurface } from './components/AlignSurface'
import { BusyStatus } from './components/BusyStatus'
import { Screen } from './components/Screen'

/**
 * Le recalage proprement dit, monté seulement une fois la photo et son cadre connus :
 * le cadrage de départ se fige alors à l état initial, sans effet de synchronisation.
 */
function Editor({
  shot,
  ghost,
  frame,
  onDone,
}: {
  shot: Shot
  /** La photo du dessous. Absente quand la série n en compte qu une. */
  ghost: Shot | undefined
  frame: Size
  onDone: () => void
}) {
  const { bitmap } = useBitmap(shot.blob)
  const { bitmap: ghostBitmap } = useBitmap(ghost?.blob)

  const shotSize = useMemo<Size>(
    () => ({ width: shot.width, height: shot.height }),
    [shot.width, shot.height],
  )
  // Le cadrage enregistré est le point de départ, et c est lui que « Remettre à zéro »
  // restitue : on annule la retouche en cours, pas le calage d origine. Il repasse par
  // `clampToCover` par précaution — une transformation venue d une version antérieure
  // pourrait ne plus couvrir le cadre.
  const initial = useMemo(
    () => clampToCover(shot.transform, shotSize, frame),
    [shot.transform, shotSize, frame],
  )

  const [transform, setTransform] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onConfirm() {
    // Garde synchrone : le bouton ne cède la place au libellé d étape qu au rendu
    // suivant, donc deux tapes rapprochées pourraient toutes deux entrer ici.
    if (saving) return
    setSaving(true)
    setError(null)
    try {
      await updateShotTransform(shot.id, transform)
      onDone()
    } catch {
      // Rien n est perdu : le cadrage à l écran reste celui qu on vient de régler, et
      // une seconde tape le réécrit.
      setSaving(false)
      setError("Le recadrage n'a pas pu être enregistré. Réessayez.")
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      <AlignSurface
        source={bitmap}
        shot={shotSize}
        frame={frame}
        ghost={
          ghost
            ? {
                source: ghostBitmap,
                transform: ghost.transform,
                shot: { width: ghost.width, height: ghost.height },
              }
            : null
        }
        initial={initial}
        value={transform}
        onChange={setTransform}
        controls={!saving}
        extraControl={
          <button
            type="button"
            data-testid="realign-cancel"
            onClick={onDone}
            className="flex-1 rounded-xl border border-slate-600 py-3"
          >
            Annuler
          </button>
        }
      />

      {saving ? (
        <BusyStatus label="Enregistrement…" />
      ) : (
        <button
          type="button"
          data-testid="realign-confirm"
          onClick={onConfirm}
          className="rounded-xl bg-sky-500 py-4 font-semibold text-slate-950"
        >
          Valider
        </button>
      )}

      {error && <p className="rounded-lg bg-red-900/90 p-3 text-sm">{error}</p>}
    </div>
  )
}

/**
 * Recadre une photo déjà enregistrée : mêmes gestes qu au moment de la prise, mais sur
 * ses pixels tels qu ils sont en base. Seul son placement dans le cadre est réécrit —
 * la photo n est jamais réencodée, et la comparaison comme les exports s en servent
 * aussitôt.
 */
export function RealignScreen() {
  const { id, shotId } = useParams<{ id: string; shotId: string }>()
  const navigate = useNavigate()
  const { shots, loading, error: shotsError } = useShots(id)

  const [frame, setFrame] = useState<Size | null>(null)
  const [frameError, setFrameError] = useState(false)
  useEffect(() => {
    if (!id) return
    setFrameError(false)
    getViewpoint(id)
      .then((found) => {
        if (!found) navigate('/', { replace: true })
        else setFrame({ width: found.frameWidth, height: found.frameHeight })
      })
      .catch(() => setFrameError(true))
  }, [id, navigate])

  const shot = shots.find((item) => item.id === shotId)
  // Toujours la première photo de la série : c est la référence qui a défini le cadre,
  // et s y rapporter empêche la série de dériver de proche en proche. Sauf quand c est
  // justement elle qu on recadre — la deuxième prend alors le relais.
  const ghost = shot && shots[0]?.id === shot.id ? shots[1] : shots[0]

  useEffect(() => {
    // Une photo supprimée depuis un autre onglet, ou une URL saisie à la main : mieux
    // vaut la série qu un écran de calage vide.
    if (!loading && !shotsError && !shot) navigate(`/v/${id}`, { replace: true })
  }, [loading, shotsError, shot, id, navigate])

  return (
    <Screen
      title="Recadrer la photo"
      back={
        <Link to={`/v/${id}`} className="text-sm text-slate-300">
          Retour
        </Link>
      }
    >
      {(shotsError || frameError) && (
        <p data-testid="realign-load-error" className="px-6 py-10 text-center text-sm text-slate-300">
          Impossible de charger cette photo.
        </p>
      )}
      {shot && frame && (
        <Editor
          shot={shot}
          ghost={ghost}
          frame={frame}
          onDone={() => navigate(`/v/${id}`, { replace: true })}
        />
      )}
    </Screen>
  )
}
