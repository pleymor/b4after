import { Link } from 'react-router'
import { useViewpoints } from '@/hooks/useViewpoints'
import { useObjectUrl } from '@/hooks/useObjectUrl'
import { formatDate } from '@/lib/format'
import type { ViewpointSummary } from '@/types'
import { FirstRunNotice } from './components/FirstRunNotice'
import { Screen } from './components/Screen'

function ViewpointRow({ summary }: { summary: ViewpointSummary }) {
  const thumbUrl = useObjectUrl(summary.coverThumb)

  return (
    // Deux liens frères, jamais imbriqués : le second (« Reprendre ») a été ajouté
    // après coup pour ramener la reprise à trois tapes depuis l accueil, et une
    // balise <a> ne peut pas en contenir une autre.
    <li className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
      <Link
        to={`/v/${summary.id}`}
        data-testid="viewpoint-item"
        className="flex min-w-0 flex-1 items-center gap-4"
      >
        <div className="size-16 shrink-0 overflow-hidden rounded-lg bg-slate-700">
          {thumbUrl && <img src={thumbUrl} alt="" className="size-full object-cover" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium">{summary.name}</p>
          <p className="text-sm text-slate-400">
            {summary.shotCount === 1 ? '1 photo' : `${summary.shotCount} photos`}
            {summary.lastShotAt !== null && ` · ${formatDate(summary.lastShotAt)}`}
          </p>
        </div>
      </Link>
      {summary.shotCount > 0 && (
        // Rien à superposer sur un point de vue sans photo : l affordance ne
        // s affiche que lorsqu il y a un fantôme à montrer.
        <Link
          to={`/v/${summary.id}/capture`}
          data-testid="retake"
          aria-label={`Reprendre la photo de ${summary.name}`}
          className="shrink-0 rounded-lg border border-slate-600 px-3 py-2 text-sm text-slate-200"
        >
          Reprendre
        </Link>
      )}
    </li>
  )
}

export function ViewpointListScreen() {
  const { summaries, loading, error } = useViewpoints()

  return (
    <Screen
      title="b4after"
      action={
        <Link to="/settings" className="text-sm text-slate-300">
          Réglages
        </Link>
      }
    >
      <FirstRunNotice />

      {error && (
        <div data-testid="viewpoints-error" className="px-6 py-12 text-center text-slate-300">
          <p className="text-lg font-medium">Impossible de charger vos points de vue.</p>
        </div>
      )}

      {!loading && !error && summaries.length === 0 && (
        <div data-testid="empty-state" className="px-6 py-12 text-center text-slate-300">
          <p className="text-lg font-medium">Aucun point de vue</p>
          <p className="mt-2 text-sm">
            Un point de vue, c'est un endroit d'où vous reprendrez la même photo au fil du
            chantier. Créez-en un et prenez la photo de référence.
          </p>
        </div>
      )}

      <ul data-testid="viewpoint-list">
        {summaries.map((summary) => (
          <ViewpointRow key={summary.id} summary={summary} />
        ))}
      </ul>

      <Link
        to="/capture"
        data-testid="new-viewpoint"
        className="fixed inset-x-4 bottom-4 rounded-xl bg-sky-500 py-4 text-center font-semibold text-slate-950"
      >
        Nouveau point de vue
      </Link>
    </Screen>
  )
}
