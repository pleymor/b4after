import { useState } from 'react'

const STORAGE_KEY = 'b4after.first-run-acknowledged'

export function FirstRunNotice() {
  const [acknowledged, setAcknowledged] = useState(
    () => localStorage.getItem(STORAGE_KEY) === '1',
  )

  if (acknowledged) return null

  return (
    <div
      data-testid="first-run-notice"
      className="fixed inset-0 z-50 flex items-end bg-slate-950/80 p-4"
    >
      <div className="w-full rounded-2xl bg-slate-800 p-5">
        <h2 className="text-lg font-semibold">Vos photos restent sur cet appareil</h2>
        <p className="mt-2 text-sm text-slate-300">
          b4after n'envoie rien sur Internet et ne demande aucun compte. En contrepartie,
          effacer les données de votre navigateur efface aussi vos photos. Pensez à exporter
          les comparaisons qui comptent.
        </p>
        <button
          type="button"
          className="mt-4 w-full rounded-xl bg-sky-500 py-3 font-semibold text-slate-950"
          onClick={() => {
            localStorage.setItem(STORAGE_KEY, '1')
            setAcknowledged(true)
          }}
        >
          J'ai compris
        </button>
      </div>
    </div>
  )
}
