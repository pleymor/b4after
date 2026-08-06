/**
 * Icônes en SVG inline. Une bibliothèque d'icônes pour deux glyphes alourdirait le
 * paquet d'une PWA dont l'installation hors ligne est un objectif.
 */
const COMMON = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
}

/** Deux cadres accolés : l'image côte-à-côte. */
export function SideBySideIcon() {
  return (
    <svg {...COMMON}>
      <rect x="2.5" y="5" width="8" height="14" rx="1.5" />
      <rect x="13.5" y="5" width="8" height="14" rx="1.5" />
    </svg>
  )
}

/** Un triangle de lecture dans un cadre : l'export animé. */
export function PlayIcon() {
  return (
    <svg {...COMMON}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="M10 9.5l5 2.5-5 2.5z" />
    </svg>
  )
}
