/**
 * Une ligne de réglage : un libellé et un groupe de boutons à choix unique. Six
 * usages entre les deux feuilles — le factoriser évite six copies du même balisage,
 * et garantit que les six se comportent pareil.
 */
export function OptionRow<T extends string | number>({
  label,
  value,
  options,
  onChange,
  testId,
}: {
  label: string
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  testId?: string
}) {
  return (
    <div className="space-y-2" data-testid={testId}>
      <p className="text-sm text-slate-300">{label}</p>
      {/* `radiogroup` plutôt que des <input type="radio"> : le rendu attendu est un
          segmenté, et les rôles ARIA le décrivent sans lutter contre le style natif. */}
      <div role="radiogroup" aria-label={label} className="flex gap-2">
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={String(option.value)}
              type="button"
              role="radio"
              aria-checked={selected}
              data-value={option.value}
              onClick={() => onChange(option.value)}
              className={`flex-1 rounded-lg border px-3 py-2 text-sm ${
                selected
                  ? 'border-sky-400 bg-sky-500/15 text-sky-100'
                  : 'border-slate-600 text-slate-300'
              }`}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}
