import { useEffect, type ReactNode } from 'react'

/**
 * Feuille modale ancrée en bas de l'écran. Générique et sans logique métier : elle ne
 * sait rien des réglages qu'on lui confie.
 */
export function Sheet({
  title,
  open,
  onClose,
  children,
}: {
  title: string
  open: boolean
  onClose: () => void
  children: ReactNode
}) {
  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-10 flex flex-col justify-end">
      {/* Le voile ferme la feuille et absorbe les tapes qui la manquent : sans lui, une
          tape à côté atteindrait le curseur de révélation situé dessous.

          Hors de l'arbre d'accessibilité, volontairement : c'est une commodité pour le
          pointeur, redondante avec la croix de l'en-tête et la touche Échap. Exposé
          comme bouton nommé « Fermer », il entrerait en collision avec celle de
          l'en-tête — et la correspondance par sous-chaîne de Playwright rend un simple
          renommage insuffisant. */}
      <div aria-hidden="true" onClick={onClose} className="flex-1 bg-slate-950/70" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85%] overflow-y-auto rounded-t-2xl border-t border-slate-700 bg-slate-900 pb-[env(safe-area-inset-bottom)]"
      >
        <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <h2 className="flex-1 font-semibold text-slate-100">{title}</h2>
          <button
            type="button"
            data-testid="close-sheet"
            onClick={onClose}
            aria-label="Fermer"
            className="px-2 text-lg text-slate-300"
          >
            ✕
          </button>
        </header>
        <div className="space-y-5 p-4">{children}</div>
      </div>
    </div>
  )
}
