export function CameraDeniedNotice({
  status,
  onRetry,
}: {
  status: 'denied' | 'unavailable'
  onRetry: () => void
}) {
  return (
    <div data-testid="camera-denied" className="px-6 py-12 text-center text-slate-300">
      <p className="text-lg font-medium">
        {status === 'denied' ? 'Accès à la caméra refusé' : 'Caméra indisponible'}
      </p>
      <p className="mt-2 text-sm">
        {status === 'denied'
          ? 'b4after a besoin de la caméra pour reprendre la photo. Si le refus a été mémorisé, autorisez la caméra dans les réglages du navigateur pour ce site, puis réessayez.'
          : 'Aucune caméra accessible depuis ce navigateur. Vos photos déjà prises restent consultables et exportables.'}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-6 rounded-xl bg-sky-500 px-6 py-3 font-semibold text-slate-950"
      >
        Réessayer
      </button>
    </div>
  )
}
