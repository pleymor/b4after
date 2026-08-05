/**
 * Remplace le bouton d action pendant un travail en cours, en nommant l étape.
 *
 * Prend la place du bouton au lieu de le griser : un bouton grisé se lit comme une
 * interface cassée, alors qu un rond qui tourne et une étape nommée disent que quelque
 * chose avance, et quoi.
 */
export function BusyStatus({ label }: { label: string }) {
  return (
    <p
      data-testid="busy-status"
      role="status"
      className="flex items-center justify-center gap-3 py-4 text-sm text-slate-300"
    >
      <span
        aria-hidden="true"
        className="size-5 shrink-0 animate-spin rounded-full border-2 border-slate-600 border-t-sky-400"
      />
      {label}
    </p>
  )
}
