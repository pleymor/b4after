import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router'
import { formatBytes, getStorageEstimate, isPersisted, requestPersistence } from '@/db/storage'
import { Screen } from './components/Screen'

export function SettingsScreen() {
  const [estimate, setEstimate] = useState<{ usage: number; quota: number } | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)

  const refresh = useCallback(() => {
    getStorageEstimate().then(setEstimate)
    isPersisted().then(setPersisted)
  }, [])

  useEffect(refresh, [refresh])

  return (
    <Screen
      title="Réglages"
      back={
        <Link to="/" className="text-sm text-slate-300">
          Retour
        </Link>
      }
    >
      <div className="space-y-6 p-4 text-sm">
        <section className="space-y-2">
          <h2 className="font-semibold text-slate-200">Stockage</h2>
          <p data-testid="storage-usage" className="text-slate-300">
            {estimate
              ? `${formatBytes(estimate.usage)} utilisés${
                  estimate.quota > 0 ? ` sur ${formatBytes(estimate.quota)} disponibles` : ''
                }`
              : 'Consommation inconnue sur ce navigateur.'}
          </p>
          <p data-testid="persistence-state" className="text-slate-400">
            {persisted === null
              ? 'Vérification de la persistance…'
              : persisted
                ? 'Le navigateur a accepté de conserver durablement vos photos.'
                : 'Le navigateur peut purger vos photos pour libérer de la place.'}
          </p>
          {persisted === false && (
            <button
              type="button"
              data-testid="request-persistence"
              onClick={() => requestPersistence().then(refresh)}
              className="rounded-xl border border-slate-600 px-4 py-2"
            >
              Demander la persistance
            </button>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-slate-200">Vos données</h2>
          <p className="text-slate-300">
            Tout reste sur cet appareil : aucune photo n'est envoyée sur Internet, aucun compte
            n'est nécessaire. Effacer les données du navigateur pour ce site efface aussi vos
            points de vue.
          </p>
        </section>

        <p data-testid="app-version" className="text-slate-500">
          Version {__APP_VERSION__}
        </p>
      </div>
    </Screen>
  )
}
