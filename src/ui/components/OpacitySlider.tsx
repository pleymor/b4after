export function OpacitySlider({
  value,
  onChange,
  label = 'Opacité du fantôme',
}: {
  value: number
  onChange: (value: number) => void
  label?: string
}) {
  return (
    <label className="flex items-center gap-3 text-sm text-slate-200">
      <span className="shrink-0">{label}</span>
      <input
        type="range"
        data-testid="opacity-slider"
        min={0}
        max={1}
        step={0.05}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className="flex-1"
        aria-label={label}
      />
    </label>
  )
}
