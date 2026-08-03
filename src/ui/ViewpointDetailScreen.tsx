import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { deleteShot } from '@/db/shots'
import { deleteViewpoint, getViewpoint, renameViewpoint } from '@/db/viewpoints'
import { useObjectUrl } from '@/hooks/useObjectUrl'
import { useShots } from '@/hooks/useShots'
import { formatDate } from '@/lib/format'
import type { Shot, Viewpoint } from '@/types'
import { Screen } from './components/Screen'

function ShotRow({
  shot,
  isBefore,
  isAfter,
  onSelectBefore,
  onSelectAfter,
  onDelete,
}: {
  shot: Shot
  isBefore: boolean
  isAfter: boolean
  onSelectBefore: () => void
  onSelectAfter: () => void
  onDelete: () => void
}) {
  const thumbUrl = useObjectUrl(shot.thumbBlob)

  return (
    <li data-testid="shot-item" className="flex items-center gap-3 border-b border-slate-800 p-3">
      <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-slate-700">
        {thumbUrl && <img src={thumbUrl} alt="" className="size-full object-cover" />}
      </div>
      <p className="flex-1 text-sm">{formatDate(shot.takenAt)}</p>
      <label className="flex flex-col items-center text-xs text-slate-300">
        Avant
        <input
          type="radio"
          name="before"
          data-testid="select-before"
          checked={isBefore}
          onChange={onSelectBefore}
        />
      </label>
      <label className="flex flex-col items-center text-xs text-slate-300">
        Après
        <input
          type="radio"
          name="after"
          data-testid="select-after"
          checked={isAfter}
          onChange={onSelectAfter}
        />
      </label>
      <button
        type="button"
        data-testid="delete-shot"
        onClick={onDelete}
        aria-label={`Supprimer la photo du ${formatDate(shot.takenAt)}`}
        className="px-2 text-slate-400"
      >
        ✕
      </button>
    </li>
  )
}

export function ViewpointDetailScreen() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { shots, loading, reload } = useShots(id)

  const [viewpoint, setViewpoint] = useState<Viewpoint | null>(null)
  useEffect(() => {
    if (!id) return
    getViewpoint(id).then((found) => {
      if (!found) navigate('/', { replace: true })
      else setViewpoint(found)
    })
  }, [id, navigate])

  const [before, setBefore] = useState<string | null>(null)
  const [after, setAfter] = useState<string | null>(null)

  // La comparaison attendue par défaut : la plus ancienne contre la plus récente.
  useEffect(() => {
    if (shots.length < 2) {
      setBefore(shots[0]?.id ?? null)
      setAfter(null)
      return
    }
    setBefore(shots[0].id)
    setAfter(shots[shots.length - 1].id)
  }, [shots])

  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')

  async function onDeleteShot(shotId: string) {
    if (!window.confirm('Supprimer cette photo ? Cette action est définitive.')) return
    await deleteShot(shotId)
    reload()
  }

  async function onDeleteViewpoint() {
    if (!id) return
    if (!window.confirm('Supprimer ce point de vue et toutes ses photos ?')) return
    await deleteViewpoint(id)
    navigate('/', { replace: true })
  }

  return (
    <Screen
      title={viewpoint?.name ?? ''}
      back={
        <Link to="/" className="text-sm text-slate-300">
          Retour
        </Link>
      }
      action={
        <button
          type="button"
          data-testid="rename"
          onClick={() => {
            setDraftName(viewpoint?.name ?? '')
            setRenaming(true)
          }}
          className="text-sm text-slate-300"
        >
          Renommer
        </button>
      }
    >
      {!loading && shots.length === 0 && (
        <p className="px-6 py-10 text-center text-sm text-slate-300">
          Aucune photo dans ce point de vue. Reprenez-en une pour redémarrer la série.
        </p>
      )}

      <ul>
        {shots.map((shot) => (
          <ShotRow
            key={shot.id}
            shot={shot}
            isBefore={before === shot.id}
            isAfter={after === shot.id}
            onSelectBefore={() => setBefore(shot.id)}
            onSelectAfter={() => setAfter(shot.id)}
            onDelete={() => onDeleteShot(shot.id)}
          />
        ))}
      </ul>

      <div className="space-y-2 p-4">
        <Link
          to={`/v/${id}/capture`}
          data-testid="retake-shot"
          className="block rounded-xl bg-sky-500 py-4 text-center font-semibold text-slate-950"
        >
          Reprendre la photo
        </Link>
        <button
          type="button"
          data-testid="compare"
          disabled={!before || !after || before === after}
          onClick={() => navigate(`/v/${id}/compare?before=${before}&after=${after}`)}
          className="w-full rounded-xl border border-slate-600 py-4 disabled:opacity-40"
        >
          Comparer
        </button>
        <button
          type="button"
          data-testid="delete-viewpoint"
          onClick={onDeleteViewpoint}
          className="w-full py-3 text-sm text-red-400"
        >
          Supprimer ce point de vue
        </button>
      </div>

      {renaming && (
        <div className="fixed inset-0 z-50 flex items-end bg-slate-950/80 p-4">
          <div className="w-full space-y-3 rounded-2xl bg-slate-800 p-4">
            <label className="block text-sm text-slate-300" htmlFor="rename-input">
              Nom du point de vue
            </label>
            <input
              id="rename-input"
              data-testid="name-input"
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              className="w-full rounded-lg bg-slate-900 px-3 py-3"
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setRenaming(false)}
                className="flex-1 rounded-xl border border-slate-600 py-3"
              >
                Annuler
              </button>
              <button
                type="button"
                data-testid="name-confirm"
                onClick={async () => {
                  if (!id) return
                  const name = draftName.trim() || (viewpoint?.name ?? '')
                  await renameViewpoint(id, name)
                  setViewpoint((current) => (current ? { ...current, name } : current))
                  setRenaming(false)
                }}
                className="flex-1 rounded-xl bg-sky-500 py-3 font-semibold text-slate-950"
              >
                Enregistrer
              </button>
            </div>
          </div>
        </div>
      )}
    </Screen>
  )
}
