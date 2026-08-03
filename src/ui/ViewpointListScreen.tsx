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
    <Link
      to={`/v/${summary.id}`}
      data-testid="viewpoint-item"
      className="flex items-center gap-4 border-b border-slate-800 px-4 py-3"
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
  )
}

export function ViewpointListScreen() {
  const { summaries, loading } = useViewpoints()

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

      {!loading && summaries.length === 0 && (
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
          <li key={summary.id}>
            <ViewpointRow summary={summary} />
          </li>
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
