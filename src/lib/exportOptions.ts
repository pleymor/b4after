export type StampMode = 'none' | 'date' | 'datetime'
export type Layout = 'auto' | 'horizontal' | 'vertical'
export type Transition = 'crossfade' | 'cut' | 'wipe'
/** Largeur cible d un export animé ; `'full'` = la largeur du cadre, plafonnée. */
export type VideoWidth = 640 | 1080 | 'full'
/** Nombre d allers-retours joués à la suite. */
export type VideoLength = 1 | 3 | 5

export type ImageOptions = { stamp: StampMode; layout: Layout }
export type VideoOptions = { transition: Transition; width: VideoWidth; reps: VideoLength }
export type ExportOptions = { image: ImageOptions; video: VideoOptions }

export const STORAGE_KEY = 'b4after.exportOptions'

// Ces défauts reproduisent le comportement d avant l existence des options : bandeau
// de dates affiché, disposition déduite de l orientation du cadre, fondu enchaîné de
// trois allers-retours à 640 px. Les changer changerait le rendu de tous ceux qui
// n ont jamais ouvert une feuille de réglages.
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  image: { stamp: 'date', layout: 'auto' },
  video: { transition: 'crossfade', width: 640, reps: 3 },
}

export const STAMP_MODES: readonly StampMode[] = ['none', 'date', 'datetime']
export const LAYOUTS: readonly Layout[] = ['auto', 'horizontal', 'vertical']
export const TRANSITIONS: readonly Transition[] = ['crossfade', 'cut', 'wipe']
export const VIDEO_WIDTHS: readonly VideoWidth[] = [640, 1080, 'full']
export const VIDEO_LENGTHS: readonly VideoLength[] = [1, 3, 5]

/** Rend `value` si elle fait partie des valeurs admises, sinon le défaut du champ. */
function oneOf<T>(allowed: readonly T[], value: unknown, fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Rend l objet tel quel s il en est un, sinon un objet vide — jamais `null`. */
function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/**
 * Relit des options stockées. Ne jette jamais et valide champ par champ : une valeur
 * écrite par une version future, tronquée ou modifiée à la main ne doit pas pouvoir
 * vider l écran de comparaison, ni faire perdre les réglages voisins.
 */
export function parseExportOptions(raw: string | null): ExportOptions {
  if (!raw) return DEFAULT_EXPORT_OPTIONS

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return DEFAULT_EXPORT_OPTIONS
  }

  const root = asRecord(parsed)
  const image = asRecord(root.image)
  const video = asRecord(root.video)
  const fallback = DEFAULT_EXPORT_OPTIONS

  return {
    image: {
      stamp: oneOf(STAMP_MODES, image.stamp, fallback.image.stamp),
      layout: oneOf(LAYOUTS, image.layout, fallback.image.layout),
    },
    video: {
      transition: oneOf(TRANSITIONS, video.transition, fallback.video.transition),
      width: oneOf(VIDEO_WIDTHS, video.width, fallback.video.width),
      reps: oneOf(VIDEO_LENGTHS, video.reps, fallback.video.reps),
    },
  }
}

export function loadExportOptions(): ExportOptions {
  try {
    return parseExportOptions(localStorage.getItem(STORAGE_KEY))
  } catch {
    // `localStorage` peut lever à la simple lecture quand le stockage est bloqué.
    return DEFAULT_EXPORT_OPTIONS
  }
}

export function saveExportOptions(options: ExportOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(options))
  } catch {
    // Navigation privée ou quota atteint : le réglage s applique à l export en cours
    // mais n est pas mémorisé. Rien à dire à l utilisateur.
  }
}
