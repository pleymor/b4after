import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { deleteShot, reorderShots } from '@/db/shots'
import { deleteViewpoint, getViewpoint, renameViewpoint } from '@/db/viewpoints'
import { useObjectUrl } from '@/hooks/useObjectUrl'
import { useShots } from '@/hooks/useShots'
import { formatDate } from '@/lib/format'
import { moveBy, moveOnto } from '@/lib/reorder'
import type { Shot, Viewpoint } from '@/types'
import { Screen } from './components/Screen'

function ShotRow({
  shot,
  href,
  rank,
  total,
  dragging,
  reorderable,
  onDelete,
  onGrab,
  onDragTo,
  onDrop,
  onMove,
}: {
  shot: Shot
  /** Vers le recadrage de cette photo. */
  href: string
  rank: number
  total: number
  dragging: boolean
  reorderable: boolean
  onDelete: () => void
  onGrab: () => void
  onDragTo: (x: number, y: number) => void
  onDrop: () => void
  onMove: (delta: number) => void
}) {
  const thumbUrl = useObjectUrl(shot.thumbBlob)
  const date = formatDate(shot.takenAt)

  return (
    <li
      data-testid="shot-item"
      data-shot-id={shot.id}
      className={`flex items-center gap-2 border-b border-slate-800 p-3 ${
        dragging ? 'bg-slate-800 ring-1 ring-sky-500' : ''
      }`}
    >
      {reorderable && (
        <button
          type="button"
          data-testid="drag-shot"
          aria-label={`Déplacer la photo du ${date}, ${rank}e sur ${total}`}
          onPointerDown={(event) => {
            // Capture du pointeur : sans elle, sortir de la poignée d un pixel
            // couperait le glissement. `preventDefault` empêche le navigateur d y
            // voir une sélection de texte ou le début d un défilement.
            event.preventDefault()
            event.currentTarget.setPointerCapture(event.pointerId)
            onGrab()
          }}
          onPointerMove={(event) => onDragTo(event.clientX, event.clientY)}
          onPointerUp={onDrop}
          onPointerCancel={onDrop}
          onKeyDown={(event) => {
            const delta = event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0
            if (delta === 0) return
            // Le clavier double le glissement : la poignée s atteint à la tabulation,
            // et un ordre qui ne se change qu au doigt serait hors de portée au
            // clavier comme au lecteur d écran.
            event.preventDefault()
            onMove(delta)
          }}
          // `touch-none` est vital : sans lui le doigt ferait défiler la page au lieu
          // de traîner la ligne, et le geste ne partirait jamais.
          className="shrink-0 cursor-grab touch-none px-2 text-lg text-slate-500"
        >
          ≡
        </button>
      )}
      {/* Frère de la poignée et de la croix, jamais leur parent : une balise <a> ne
          peut pas contenir de bouton, et traîner la ligne ne doit pas naviguer — la
          poignée capture le pointeur, donc le lien ne reçoit aucun clic. */}
      <Link
        to={href}
        data-testid="realign-shot"
        aria-label={`Recadrer la photo du ${date}`}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-slate-700">
          {thumbUrl && <img src={thumbUrl} alt="" className="size-full object-cover" />}
        </div>
        <p className="min-w-0 flex-1 truncate text-sm">{date}</p>
      </Link>
      <button
        type="button"
        data-testid="delete-shot"
        onClick={onDelete}
        aria-label={`Supprimer la photo du ${date}`}
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
  const { shots, loading, error: shotsError, reload } = useShots(id)

  const [viewpoint, setViewpoint] = useState<Viewpoint | null>(null)
  const [viewpointError, setViewpointError] = useState(false)
  useEffect(() => {
    if (!id) return
    setViewpointError(false)
    getViewpoint(id)
      .then((found) => {
        if (!found) navigate('/', { replace: true })
        else setViewpoint(found)
      })
      .catch(() => {
        // Sans ce filet, un rejet laisserait `viewpoint` à `null` pour toujours : le
        // titre resterait vide et l écran entier n afficherait plus rien d utile.
        setViewpointError(true)
      })
  }, [id, navigate])

  const [renaming, setRenaming] = useState(false)
  const [draftName, setDraftName] = useState('')
  const [error, setError] = useState<string | null>(null)

  // La série est tenue à l écran pendant qu on la remanie : le doigt doit voir les
  // lignes bouger sous lui, bien avant que la base ne soit réécrite.
  const [series, setSeries] = useState<Shot[]>([])
  useEffect(() => setSeries(shots), [shots])

  const [draggingId, setDraggingId] = useState<string | null>(null)
  // L ordre au moment de la prise en main : sans lui, un simple appui sur la poignée,
  // sans le moindre déplacement, déclencherait une écriture pour rien.
  const grabbedOrder = useRef<string[]>([])

  async function persistOrder(next: Shot[]) {
    if (!id) return
    setSeries(next)
    setError(null)
    try {
      await reorderShots(
        id,
        next.map((shot) => shot.id),
      )
    } catch {
      setError("Le nouvel ordre n'a pas pu être enregistré. Réessayez.")
      // Remettre la liste sur ce que contient vraiment la base : laisser l ordre
      // rêvé à l écran ferait croire à une réussite, et la comparaison suivante
      // sortirait dans l ordre d avant.
      reload()
    }
  }

  function onDragTo(x: number, y: number) {
    if (!draggingId) return
    // Le survol se lit sous le pointeur plutôt que par un calcul de hauteurs : les
    // lignes se réordonnent en place, donc la ligne traînée reste sous le doigt.
    const over = document.elementFromPoint(x, y)?.closest('[data-shot-id]')
    const overId = over?.getAttribute('data-shot-id')
    if (!overId) return
    setSeries((current) => moveOnto(current, draggingId, overId))
  }

  function onDrop() {
    if (!draggingId) return
    setDraggingId(null)
    const ids = series.map((shot) => shot.id)
    if (ids.join() === grabbedOrder.current.join()) return
    void persistOrder(series)
  }

  // Ces deux actions sont annoncées comme définitives : un échec silencieux
  // laisserait l utilisateur croire qu elles ont abouti.
  async function onDeleteShot(shotId: string) {
    if (!window.confirm('Supprimer cette photo ? Cette action est définitive.')) return
    setError(null)
    try {
      await deleteShot(shotId)
      reload()
    } catch {
      setError('La suppression a échoué. Réessayez.')
    }
  }

  async function onDeleteViewpoint() {
    if (!id) return
    if (!window.confirm('Supprimer ce point de vue et toutes ses photos ?')) return
    setError(null)
    try {
      await deleteViewpoint(id)
      navigate('/', { replace: true })
    } catch {
      setError('La suppression a échoué. Réessayez.')
    }
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
      {(viewpointError || shotsError) && (
        <p
          data-testid="detail-load-error"
          className="px-6 py-10 text-center text-sm text-slate-300"
        >
          Impossible de charger ce point de vue.
        </p>
      )}

      {!loading && !shotsError && shots.length === 0 && (
        <p className="px-6 py-10 text-center text-sm text-slate-300">
          Aucune photo dans ce point de vue. Ajoutez-en une pour redémarrer la série.
        </p>
      )}

      {series.length > 1 && (
        <p className="px-4 pt-3 text-xs text-slate-400">
          Glissez ≡ pour changer l'ordre de la série. La dernière photo sert de repère à
          la prise suivante.
        </p>
      )}

      {/* `select-none` seulement pendant le glissement : hors geste, la date d une
          photo reste sélectionnable et copiable. */}
      <ul className={draggingId ? 'select-none' : undefined}>
        {series.map((shot, index) => (
          <ShotRow
            key={shot.id}
            shot={shot}
            href={`/v/${id}/shots/${shot.id}/align`}
            rank={index + 1}
            total={series.length}
            reorderable={series.length > 1}
            dragging={shot.id === draggingId}
            onDelete={() => onDeleteShot(shot.id)}
            onGrab={() => {
              grabbedOrder.current = series.map((item) => item.id)
              setDraggingId(shot.id)
            }}
            onDragTo={onDragTo}
            onDrop={onDrop}
            onMove={(delta) => {
              const next = moveBy(series, shot.id, delta)
              // `moveBy` rend le tableau reçu quand la photo bute en haut ou en bas :
              // une flèche maintenue n écrit alors rien.
              if (next !== series) void persistOrder(next)
            }}
          />
        ))}
      </ul>

      <div className="space-y-2 p-4">
        <Link
          to={`/v/${id}/capture`}
          data-testid="retake-shot"
          className="block rounded-xl bg-sky-500 py-4 text-center font-semibold text-slate-950"
        >
          Ajouter une photo
        </Link>
        <button
          type="button"
          data-testid="compare"
          disabled={shots.length < 2}
          onClick={() => navigate(`/v/${id}/compare`)}
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
        {error && (
          <p data-testid="detail-error" className="rounded-lg bg-red-900/90 p-3 text-sm">
            {error}
          </p>
        )}
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
                  try {
                    await renameViewpoint(id, name)
                    setViewpoint((current) => (current ? { ...current, name } : current))
                    setRenaming(false)
                  } catch {
                    setError('Le renommage a échoué. Réessayez.')
                  }
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
