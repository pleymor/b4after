import { useState } from 'react'
import { Link } from 'react-router'
import { formatDate } from '@/lib/format'
import { shareLink } from '@/share/shareLink'
import { Screen } from './components/Screen'

const REPO_URL = 'https://github.com/pleymor/b4after'

/** Messages du partage. Un partage réussi ou annulé ne mérite rien de plus. */
const SHARE_MESSAGES = {
  shared: null,
  cancelled: null,
  copied: 'Lien copié.',
  failed: 'Le partage a échoué.',
} as const

export function AboutScreen() {
  const [shareStatus, setShareStatus] = useState<string | null>(null)

  // Une constante de build absente d un bundle bricolé donnerait `NaN/NaN/NaN` : on
  // préfère ne pas rendre la ligne du tout.
  const buildTimestamp = Date.parse(__BUILD_DATE__)
  const buildDate = Number.isNaN(buildTimestamp) ? null : formatDate(buildTimestamp)

  async function share() {
    // `window.location.origin` plutôt qu un domaine codé en dur : le lien partagé est
    // celui par lequel on a ouvert l application, donc joignable, et il n y a pas de
    // constante à corriger le jour d un déménagement.
    const outcome = await shareLink(window.location.origin, 'b4after')
    setShareStatus(SHARE_MESSAGES[outcome])
  }

  return (
    <Screen
      title="À propos"
      back={
        <Link to="/settings" className="text-sm text-slate-300">
          Retour
        </Link>
      }
    >
      <div className="space-y-6 p-4 text-sm">
        <section className="space-y-2">
          <h2 className="font-semibold text-slate-200">Le projet</h2>
          <p className="text-slate-300">
            b4after sert à reprendre une photo sous le même angle qu'une photo précédente,
            puis à en générer des comparaisons avant/après. Elle a été pensée pour documenter
            un chantier : la photo de référence se superpose au flux caméra pour retrouver le
            cadrage, et un écran de calage permet d'ajuster au doigt.
          </p>
          <p className="text-slate-300">
            Tout reste sur cet appareil. Aucun compte, aucun serveur, aucun appel réseau une
            fois l'application installée.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-slate-200">L'auteur</h2>
          <p className="text-slate-300">
            Écrite par Pleymor. Le code est ouvert :{' '}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 underline"
            >
              github.com/pleymor/b4after
            </a>
          </p>
        </section>

        <section className="space-y-1">
          <h2 className="font-semibold text-slate-200">Version</h2>
          <p data-testid="app-version" className="text-slate-300">
            Version {__APP_VERSION__}
          </p>
          {buildDate && (
            <p data-testid="build-date" className="text-slate-400">
              Mise en ligne le {buildDate}
            </p>
          )}
          <p data-testid="commit-sha" className="text-slate-500">
            Révision {__COMMIT_SHA__}
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-slate-200">Partager</h2>
          <button
            type="button"
            data-testid="share-app"
            onClick={share}
            className="rounded-xl border border-slate-600 px-4 py-2"
          >
            Partager l'application
          </button>
          {shareStatus && (
            <p data-testid="share-status" className="text-slate-300">
              {shareStatus}
            </p>
          )}
        </section>
      </div>
    </Screen>
  )
}
