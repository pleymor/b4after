import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { IDENTITY, clampToCover } from '@/align/transform'
import { peekPendingShot, takePendingShot } from '@/capture/pendingShot'
import { addShot } from '@/db/shots'
import { isQuotaError } from '@/db/storage'
import { useBitmap } from '@/hooks/useBitmap'
import { useShots } from '@/hooks/useShots'
import type { Size, Transform } from '@/types'
import { AlignSurface } from './components/AlignSurface'
import { BusyStatus } from './components/BusyStatus'
import { Screen } from './components/Screen'

/** Étapes visibles de la validation : l encodage peut ne pas être fini à la tape. */
type SaveStage = 'idle' | 'encoding' | 'saving'

const STAGE_LABEL: Record<Exclude<SaveStage, 'idle'>, string> = {
  encoding: 'Encodage de la photo…',
  saving: 'Enregistrement…',
}

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
  const { bitmap: referenceBitmap } = useBitmap(reference?.blob)
  // La photo saisie se dessine directement, sans décodage : elle est déjà en mémoire sous
  // forme de canvas. La décoder depuis son blob ajoutait un troisième passage complet —
  // encodage, décodage, redécodage — entre la tape et le premier pixel affiché.
  const capturedSource = pending?.captured.source ?? null

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

  const [stage, setStage] = useState<SaveStage>('idle')
  const [error, setError] = useState<string | null>(null)

  const writingRef = useRef(false)

  async function onConfirm() {
    // Garde synchrone : le remplacement du bouton par le libellé d étape ne prend effet
    // qu au rendu suivant, donc deux tapes rapprochées pourraient toutes deux entrer ici.
    if (writingRef.current) return
    const shot = peekPendingShot()
    if (!shot || !id) return

    writingRef.current = true
    setError(null)

    // L encodage a démarré à la tape sur le déclencheur : le temps passé à caler joue en
    // sa faveur, et il est presque toujours déjà fini ici.
    setStage(shot.captured.encoding.isDone() ? 'saving' : 'encoding')

    let encoded
    try {
      encoded = await shot.captured.encoding.result()
    } catch {
      // La photo reste en attente et l encodage est réessayable : un nouvel appui repart
      // d un encodage neuf plutôt que de buter sur le même échec.
      writingRef.current = false
      setStage('idle')
      setError("La photo n'a pas pu être préparée. Réessayez.")
      return
    }

    setStage('saving')
    try {
      await addShot({
        viewpointId: id,
        blob: encoded.blob,
        thumbBlob: encoded.thumbBlob,
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
      setStage('idle')
      setError(
        isQuotaError(caught)
          ? "L'espace de stockage est plein. Supprimez d'anciennes photos, puis réessayez — celle-ci n'est pas perdue."
          : "L'enregistrement a échoué. Réessayez.",
      )
    }
  }

  if (!pending) return null

  return (
    <Screen title="Caler la photo">
      <div className="flex h-full flex-col gap-3 p-3">
        <AlignSurface
          source={capturedSource}
          shot={shotSize}
          frame={frame}
          ghost={
            reference
              ? {
                  source: referenceBitmap,
                  transform: reference.transform,
                  shot: { width: reference.width, height: reference.height },
                }
              : null
          }
          initial={initial}
          value={transform}
          onChange={setTransform}
          controls={stage === 'idle'}
          extraControl={
            // Retiré pendant l enregistrement, et pas seulement grisé : « Reprendre »
            // consomme la photo en attente, or l attente de l encodage allonge la
            // fenêtre pendant laquelle une tape la ferait disparaître sous l écriture
            // en cours.
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
          }
        />

        {stage === 'idle' ? (
          <button
            type="button"
            data-testid="align-confirm"
            onClick={onConfirm}
            className="rounded-xl bg-sky-500 py-4 font-semibold text-slate-950"
          >
            Valider
          </button>
        ) : (
          <BusyStatus label={STAGE_LABEL[stage]} />
        )}

        {error && <p className="rounded-lg bg-red-900/90 p-3 text-sm">{error}</p>}
      </div>
    </Screen>
  )
}
