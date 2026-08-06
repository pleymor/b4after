import type { Pace, Transition, VideoLength, VideoWidth } from '@/lib/exportOptions'
import type { Size } from '@/types'
import { drawTransition, scaleInput, targetWidth, type ScaledInput } from './crossfade'
import { GIF_MAX_WIDTH } from './gif'
import type { ComparisonInput } from './sideBySide'

// Même défaut que le GIF (voir gif.ts), pas un plafond : le vrai plafond commun aux
// deux exports est EXPORT_MAX_EDGE, appliqué dans targetWidth.
export const VIDEO_MAX_WIDTH = GIF_MAX_WIDTH

// Palier tenu entre deux fondus, le même quel que soit le rythme choisi : seul le
// fondu accélère ou ralentit, le temps de voir chaque photo avant que ça reparte reste
// constant (voir la spec de fluidité vidéo).
export const VIDEO_HOLD_MS = 700

// Durée du fondu selon le rythme choisi. Propre à la vidéo : le GIF garde son propre
// modèle en paliers (voir GIF_STEPS et transitionSteps dans gif.ts et crossfade.ts),
// contrainte réelle de ce format que H.264 n a pas.
const FADE_DURATION_MS: Record<Pace, number> = {
  slow: 1800,
  normal: 1200,
  fast: 700,
}

const VIDEO_MIME_CANDIDATES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4']

function abortError(): DOMException {
  return new DOMException('Export annulé', 'AbortError')
}

/** Retourne le premier type MIME vidéo pris en charge par MediaRecorder, sinon null. */
export function supportedVideoMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  return VIDEO_MIME_CANDIDATES.find((mime) => MediaRecorder.isTypeSupported(mime)) ?? null
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }
    const onAbort = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort)
  })
}

/**
 * Anime un fondu de `mixStart` à `mixEnd` sur `durationMs`, une frame par
 * `requestAnimationFrame` calculée depuis le temps réellement écoulé plutôt qu un
 * nombre fixe de paliers : c est ce qui rend le mouvement fluide au lieu de saccadé
 * (voir la spec de fluidité vidéo — `drawTransition` acceptait déjà un `mix` continu,
 * seul l appelant discrétisait).
 *
 * La toute dernière frame dessine systématiquement `mixEnd` exactement, jamais une
 * approximation : le temps écoulé réel d un `requestAnimationFrame` ne tombe presque
 * jamais pile sur `durationMs`, et l état final doit malgré tout être montré.
 */
function animateFade(
  ctx: CanvasRenderingContext2D,
  from: ScaledInput,
  to: ScaledInput,
  size: Size,
  mixStart: number,
  mixEnd: number,
  transition: Transition,
  durationMs: number,
  signal: AbortSignal | undefined,
  onElapsed: (elapsedMs: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    const startedAt = performance.now()
    let frameId = 0

    const onAbort = () => {
      cancelAnimationFrame(frameId)
      signal?.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal?.addEventListener('abort', onAbort)

    const tick = () => {
      const elapsed = performance.now() - startedAt
      if (elapsed >= durationMs) {
        drawTransition(ctx, from, to, size, mixEnd, transition)
        signal?.removeEventListener('abort', onAbort)
        onElapsed(durationMs)
        resolve()
        return
      }
      drawTransition(
        ctx,
        from,
        to,
        size,
        mixStart + (mixEnd - mixStart) * (elapsed / durationMs),
        transition,
      )
      onElapsed(elapsed)
      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
  })
}

/**
 * Transition (fondu, coupe ou balayage) de l avant vers l après, en va-et-vient
 * (avant → après → avant → …), dessinée en temps réel sur un canevas détaché, capturée
 * et encodée par `MediaRecorder`. Rejouée le nombre de fois spécifié par `reps` pour
 * qu une seule lecture se lise déjà comme une animation plutôt qu un clignement.
 *
 * Le fondu suit le temps écoulé (voir `animateFade`) et non un nombre fixe de paliers ;
 * `pace` choisit sa durée. Le palier, lui, dure toujours `VIDEO_HOLD_MS` quel que soit
 * le rythme choisi.
 */
export async function renderCrossfadeVideo(
  before: ComparisonInput,
  after: ComparisonInput,
  frame: Size,
  options: {
    transition?: Transition
    width?: VideoWidth
    reps?: VideoLength
    pace?: Pace
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
  } = {},
): Promise<Blob> {
  if (options.signal?.aborted) throw abortError()

  const mime = supportedVideoMime()
  if (!mime) throw new Error('Aucun format vidéo pris en charge')

  // Le plafond n est jamais franchi vers le haut : un export n agrandit pas.
  const widthFactor = Math.min(1, targetWidth(options.width ?? VIDEO_MAX_WIDTH, frame) / frame.width)
  const width = Math.round(frame.width * widthFactor)
  const height = Math.round(frame.height * widthFactor)

  const from = scaleInput(before, widthFactor)
  const to = scaleInput(after, widthFactor)
  const transition = options.transition ?? 'crossfade'
  const pace = options.pace ?? 'normal'

  // Coupe franche : aucun état intermédiaire à représenter, donc aucun fondu à étaler
  // dans le temps. `pace` reste donc sans effet sur cette transition, volontairement :
  // accélérer ou ralentir un fondu qui n existe pas n aurait pas de sens. Le palier,
  // lui, reste à VIDEO_HOLD_MS pour les trois transitions.
  const fadeMs = transition === 'cut' ? 0 : FADE_DURATION_MS[pace]

  // Trois allers-retours par défaut, soit environ 5,7 s à rythme normal : un seul aller
  // ne dure que le temps d'une prise plus un fondu et se lit comme un instantané figé
  // plutôt que comme une animation.
  const reps = options.reps ?? 3

  // `captureStream` n existe que sur l élément DOM, pas sur `OffscreenCanvas` :
  // contrairement au GIF, cet export doit passer par un vrai canevas, ici jamais
  // attaché au document.
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const maybeCtx = canvas.getContext('2d')
  if (!maybeCtx) throw new Error('Contexte 2D indisponible')
  const ctx = maybeCtx

  // Un taux explicite plutôt que la capture « au repaint » par défaut : sans lui
  // la cadence dépend du navigateur. À 30 im/s le flux échantillonne le canevas à
  // cadence fixe ; comme le canevas est désormais redessiné en continu pendant un
  // fondu (voir animateFade), ces 30 images par seconde sont bien 30 images
  // distinctes, plus les longues plages immobiles des paliers, que H.264 compresse en
  // quasi-rien.
  const stream = canvas.captureStream(30)
  const recorder = new MediaRecorder(stream, { mimeType: mime })
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  // Un aller-retour vaut palier + fondu. Pour une coupe franche (`fadeMs === 0`), la
  // boucle ne dessine que le palier de *départ* de chaque aller-retour ; l état atteint
  // après le dernier aller-retour n est donc jamais dessiné par la boucle elle-même
  // (voir plus bas). D où le palier supplémentaire : sans lui la barre de progression
  // n atteindrait jamais 100 %. `crossfade` et `wipe` n en ont pas besoin : leur
  // dernière frame de fondu dessine déjà l état final.
  const totalMs = fadeMs === 0 ? reps * VIDEO_HOLD_MS + VIDEO_HOLD_MS : reps * (VIDEO_HOLD_MS + fadeMs)

  return new Promise<Blob>((resolve, reject) => {
    let settled = false

    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort)
      for (const track of stream.getTracks()) track.stop()
    }
    const stopRecorder = () => {
      if (recorder.state !== 'inactive') recorder.stop()
    }
    const fail = (error: unknown) => {
      if (settled) return
      settled = true
      stopRecorder()
      cleanup()
      reject(error)
    }
    const onAbort = () => fail(abortError())
    options.signal?.addEventListener('abort', onAbort)

    recorder.onerror = () => fail(new Error("Échec de l'encodage vidéo"))
    recorder.onstop = () => {
      if (settled) return
      settled = true
      cleanup()
      resolve(new Blob(chunks, { type: mime }))
    }

    recorder.start()
    ;(async () => {
      // Temps de vidéo déjà couvert par les allers-retours précédents : la progression
      // rapporte ce temps écoulé à `totalMs`, pas un compte de paliers franchis, pour
      // rester une mesure temporelle fidèle même quand un fondu dure des secondes.
      let elapsed = 0
      let mix = 0
      for (let rep = 0; rep < reps; rep += 1) {
        const target = 1 - mix

        drawTransition(ctx, from, to, { width, height }, mix, transition)
        await wait(VIDEO_HOLD_MS, options.signal)
        elapsed += VIDEO_HOLD_MS
        options.onProgress?.(elapsed, totalMs)

        if (fadeMs > 0) {
          const base = elapsed
          await animateFade(
            ctx,
            from,
            to,
            { width, height },
            mix,
            target,
            transition,
            fadeMs,
            options.signal,
            (fadeElapsed) => options.onProgress?.(base + fadeElapsed, totalMs),
          )
          elapsed = base + fadeMs
        }

        mix = target
      }

      // Coupe franche : `fadeMs` vaut 0, donc la boucle ci-dessus n a dessiné que les
      // paliers de *départ* de chaque aller-retour, jamais l état atteint après le
      // dernier. Sans ce palier, la vidéo s arrêterait sur le dernier avant affiché et
      // ne montrerait jamais l après, même si `mix` vaut bien `target` à ce point.
      if (fadeMs === 0) {
        drawTransition(ctx, from, to, { width, height }, mix, transition)
        await wait(VIDEO_HOLD_MS, options.signal)
        elapsed += VIDEO_HOLD_MS
        options.onProgress?.(elapsed, totalMs)
      }

      stopRecorder()
    })().catch(fail)
  })
}
