import type { Pace, Transition, VideoLength, VideoWidth } from '@/lib/exportOptions'
import type { Size } from '@/types'
import {
  bounceIndex,
  decodeScaled,
  drawSingle,
  drawTransition,
  scaleInput,
  targetWidth,
  type DecodedInput,
} from './crossfade'
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
  from: DecodedInput,
  to: DecodedInput,
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
 * Transition (fondu, coupe ou balayage) qui parcourt toute la série en va-et-vient
 * (photo 1 → photo 2 → … → dernière → … → photo 1 → …), dessinée en temps réel sur un
 * canevas détaché, capturée et encodée par `MediaRecorder`.
 *
 * `reps` compte des demi-passes, comme avant : sur une comparaison à deux photos, une
 * demi-passe est un aller-retour complet (l unique intervalle est parcouru une fois),
 * donc `reps` défauts et sorties restent identiques à l ancien modèle avant/après. Sur
 * une série de N photos, une demi-passe traverse ses N-1 intervalles : `reps` (impair
 * dans les trois valeurs proposées) garantit que la vidéo se termine toujours sur la
 * dernière photo, quelle que soit la longueur de la série (voir `bounceIndex`).
 *
 * Décode une photo à la fois, au plus deux bitmaps vivants simultanément — celle qu on
 * quitte et celle qu on rejoint — jamais toute la série (voir la spec, § Mémoire).
 *
 * Le fondu suit le temps écoulé (voir `animateFade`) et non un nombre fixe de paliers ;
 * `pace` choisit sa durée. Le palier, lui, dure toujours `VIDEO_HOLD_MS` quel que soit
 * le rythme choisi.
 */
export async function renderCrossfadeVideo(
  inputs: ComparisonInput[],
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

  const scaled = inputs.map((input) => scaleInput(input, widthFactor))
  const count = inputs.length
  const transition = options.transition ?? 'crossfade'
  const pace = options.pace ?? 'normal'

  // Coupe franche : aucun état intermédiaire à représenter, donc aucun fondu à étaler
  // dans le temps. `pace` reste donc sans effet sur cette transition, volontairement :
  // accélérer ou ralentir un fondu qui n existe pas n aurait pas de sens. Le palier,
  // lui, reste à VIDEO_HOLD_MS pour les trois transitions.
  const fadeMs = transition === 'cut' ? 0 : FADE_DURATION_MS[pace]

  // Trois demi-passes par défaut : voir le commentaire de la fonction pour la
  // correspondance exacte avec l ancien modèle à deux photos.
  const reps = options.reps ?? 3
  const totalSteps = reps * (count - 1)

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

  // Un pas vaut palier + fondu. Pour une coupe franche (`fadeMs === 0`), la boucle ne
  // dessine que le palier de *départ* de chaque pas ; l état atteint après le dernier
  // pas n est donc jamais dessiné par la boucle elle-même (voir plus bas). D où le
  // palier supplémentaire : sans lui la barre de progression n atteindrait jamais
  // 100 %. `crossfade` et `wipe` n en ont pas besoin : leur dernière frame de fondu
  // dessine déjà l état final.
  const totalMs =
    fadeMs === 0 ? totalSteps * VIDEO_HOLD_MS + VIDEO_HOLD_MS : totalSteps * (VIDEO_HOLD_MS + fadeMs)

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
      // Temps de vidéo déjà couvert par le pas précédent : la progression rapporte ce
      // temps écoulé à `totalMs`, pas un compte de pas franchis, pour rester une
      // mesure temporelle fidèle même quand un fondu dure des secondes.
      let elapsed = 0
      let current = await decodeScaled(scaled[0])
      try {
        for (let step = 0; step < totalSteps; step += 1) {
          const nextIndex = bounceIndex(step + 1, count)
          const next = await decodeScaled(scaled[nextIndex])
          try {
            drawTransition(ctx, current, next, { width, height }, 0, transition)
            await wait(VIDEO_HOLD_MS, options.signal)
            elapsed += VIDEO_HOLD_MS
            options.onProgress?.(elapsed, totalMs)

            if (fadeMs > 0) {
              const base = elapsed
              await animateFade(
                ctx,
                current,
                next,
                { width, height },
                0,
                1,
                transition,
                fadeMs,
                options.signal,
                (fadeElapsed) => options.onProgress?.(base + fadeElapsed, totalMs),
              )
              elapsed = base + fadeMs
            }
          } catch (error) {
            // `current` est fermé par le `finally` ci-dessous : sur cette branche
            // d erreur (annulation en cours de pas), c est `next` qu il faut fermer
            // nous-mêmes, faute de quoi il ne serait jamais réassigné à `current` et
            // resterait ouvert.
            next.bitmap.close()
            throw error
          } finally {
            current.bitmap.close()
          }
          current = next
        }

        // Coupe franche : `fadeMs` vaut 0, donc la boucle ci-dessus n a dessiné que les
        // paliers de *départ* de chaque pas, jamais l état atteint après le dernier.
        // Sans ce palier, la vidéo s arrêterait sur l avant-dernière photo affichée et
        // ne montrerait jamais la dernière.
        if (fadeMs === 0) {
          drawSingle(ctx, current, { width, height })
          await wait(VIDEO_HOLD_MS, options.signal)
          elapsed += VIDEO_HOLD_MS
          options.onProgress?.(elapsed, totalMs)
        }
      } finally {
        current.bitmap.close()
      }

      stopRecorder()
    })().catch(fail)
  })
}
