import { useRegisterSW } from 'virtual:pwa-register/react'

/**
 * Signale qu une nouvelle version est installée et attend d être activée.
 *
 * On demande plutôt qu on impose : recharger d autorité interromprait un calage en
 * cours, et la photo en attente ne vit qu en mémoire — elle serait perdue. C est
 * l utilisateur qui choisit le moment.
 */
export function UpdateNotice() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW()

  if (!needRefresh) return null

  return (
    <div
      data-testid="update-notice"
      className="fixed inset-x-4 bottom-4 z-50 flex items-center gap-3 rounded-xl bg-sky-500 p-3 text-slate-950 shadow-lg"
    >
      <p className="flex-1 text-sm font-medium">Une nouvelle version est disponible.</p>
      <button
        type="button"
        data-testid="update-dismiss"
        onClick={() => setNeedRefresh(false)}
        className="px-2 text-sm underline"
      >
        Plus tard
      </button>
      <button
        type="button"
        data-testid="update-reload"
        onClick={() => updateServiceWorker(true)}
        className="rounded-lg bg-slate-950 px-3 py-2 text-sm font-semibold text-sky-400"
      >
        Recharger
      </button>
    </div>
  )
}
