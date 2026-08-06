import type { HoldDuration, Pace, Transition, VideoOptions, VideoWidth } from '@/lib/exportOptions'
import type { Size } from '@/types'
import {
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

// Durée du palier tenu sur chaque photo, selon le réglage choisi. Le même réglage
// pilote tous les paliers de la série : pas de contrôle indépendant photo par photo
// (voir la spec du passage unique).
export const HOLD_DURATION_MS: Record<HoldDuration, number> = {
  short: 700,
  medium: 1200,
  long: 2000,
}

// Durée du fondu selon le rythme choisi. Propre à la vidéo : le GIF garde son propre
// modèle en paliers (voir GIF_STEPS et transitionSteps dans gif.ts et crossfade.ts),
// contrainte réelle de ce format que H.264 n a pas.
const FADE_DURATION_MS: Record<Pace, number> = {
  slow: 1800,
  normal: 1200,
  fast: 700,
}

/**
 * Durée totale annoncée pour une série de `count` photos avec ces options : N
 * paliers + N-1 fondus (nuls en coupe franche, voir `fadeMs` dans
 * `renderCrossfadeVideo`). Seule source de vérité pour ce calcul —
 * `renderCrossfadeVideo` appelle cette même fonction pour son propre total, plutôt
 * que de recalculer la formule de son côté, afin que le chiffre annoncé à
 * l utilisateur et la vidéo produite ne puissent jamais diverger.
 */
export function videoDurationMs(count: number, options: VideoOptions): number {
  const holdMs = HOLD_DURATION_MS[options.hold]
  const fadeMs = options.transition === 'cut' ? 0 : FADE_DURATION_MS[options.pace]
  const gaps = Math.max(0, count - 1)
  return count * holdMs + gaps * fadeMs
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
 * Tient un contenu immobile affiché pendant `durationMs`, en le redessinant à chaque
 * `requestAnimationFrame` plutôt que de simplement attendre `durationMs` par un
 * minuteur — ce dernier paraît suffisant (le contenu ne change pas, alors pourquoi le
 * redessiner ?) mais ne l est pas : `canvas.captureStream()` n émet une frame que
 * lorsque le canevas change, jamais sur une simple horloge. Un minuteur laisserait
 * donc le canevas parfaitement immobile pendant tout le palier, et le flux cesserait
 * d émettre jusqu au prochain redessin réel. Pour un palier intermédiaire ça ne se
 * voit pas, le fondu suivant vient combler l absence de frames. Mais le tout dernier
 * palier n a pas de fondu après lui : sans redessin, la vidéo s arrête net sur la fin
 * de la transition qui le précède, avant même d avoir montré le palier promis — le
 * bug d origine. Redessiner à l identique à chaque frame marque le canevas comme
 * modifié et fait circuler le flux tout du long, sans rien changer à l image montrée.
 */
function holdFrame(
  draw: () => void,
  durationMs: number,
  signal: AbortSignal | undefined,
  onElapsed: (elapsedMs: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError())
      return
    }

    draw()
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
        signal?.removeEventListener('abort', onAbort)
        onElapsed(durationMs)
        resolve()
        return
      }
      draw()
      onElapsed(elapsed)
      frameId = requestAnimationFrame(tick)
    }

    frameId = requestAnimationFrame(tick)
  })
}

/**
 * Transition (fondu, coupe ou balayage) qui parcourt toute la série en un seul passage
 * (palier sur la photo 1 → transition → palier sur la photo 2 → … → palier sur la
 * dernière), dessinée en temps réel sur un canevas détaché, capturée et encodée par
 * `MediaRecorder`. Un seul passage suffit au propos d une comparaison avant/après ; un
 * aller-retour supplémentaire n ajoute que de la longueur (voir la spec du passage
 * unique) — généralisé ici à N photos plutôt qu à une seule paire (voir la spec de
 * comparaison de série).
 *
 * Décode une photo à la fois, au plus deux bitmaps vivants simultanément — celle qu on
 * quitte et celle qu on rejoint — jamais toute la série (voir la spec, § Mémoire).
 *
 * Le fondu suit le temps écoulé (voir `animateFade`) et non un nombre fixe de
 * paliers ; `pace` choisit sa durée. Le palier, lui, dure `HOLD_DURATION_MS[hold]`,
 * le même sur chaque photo quel que soit le rythme choisi.
 */
export async function renderCrossfadeVideo(
  inputs: ComparisonInput[],
  frame: Size,
  options: {
    transition?: Transition
    width?: VideoWidth
    hold?: HoldDuration
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
  const holdMs = HOLD_DURATION_MS[options.hold ?? 'medium']

  // Coupe franche : aucun état intermédiaire à représenter, donc aucun fondu à étaler
  // dans le temps. `pace` reste donc sans effet sur cette transition, volontairement :
  // accélérer ou ralentir un fondu qui n existe pas n aurait pas de sens. Le palier,
  // lui, s applique aux trois transitions.
  const fadeMs = transition === 'cut' ? 0 : FADE_DURATION_MS[pace]

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

  // Un seul passage sur toute la série : N paliers, N-1 fondus (éventuellement nuls
  // en coupe franche) — la généralisation directe du passage unique à deux photos.
  // Même formule que celle annoncée dans la feuille de réglages avant l export (voir
  // `videoDurationMs`), et non recalculée ici : le chiffre affiché et la vidéo
  // produite ne peuvent ainsi jamais diverger.
  const totalMs = videoDurationMs(count, {
    transition,
    width: options.width ?? VIDEO_MAX_WIDTH,
    hold: options.hold ?? 'medium',
    pace,
  })

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
      // Temps de vidéo déjà couvert par le palier ou le fondu précédent : la
      // progression rapporte ce temps écoulé à `totalMs`, pas un compte de paliers
      // franchis, pour rester une mesure temporelle fidèle même quand un fondu dure
      // des secondes.
      let elapsed = 0
      let current = await decodeScaled(scaled[0])
      try {
        // Palier sur la première photo : la seule qu on affiche sans avoir encore
        // besoin de décoder la suivante. `holdFrame`, pas un simple dessin suivi
        // d une attente : voir sa documentation pour la raison.
        await holdFrame(
          () => drawSingle(ctx, current, { width, height }),
          holdMs,
          options.signal,
          (holdElapsed) => options.onProgress?.(holdElapsed, totalMs),
        )
        elapsed += holdMs
        options.onProgress?.(elapsed, totalMs)

        for (let index = 1; index < count; index += 1) {
          const next = await decodeScaled(scaled[index])
          try {
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

            // Le palier sur cette photo : c est lui qui garantit que la vidéo se
            // termine sur la dernière photo de la série, et non sur la dernière image
            // de la transition. Sans lui, un fondu s arrêterait net à `mix === 1` —
            // une seule frame — et une coupe ne montrerait jamais la photo suivante du
            // tout. `drawSingle` couvre aussi la coupe franche : basculer directement
            // sur l état final, sans fondu, est exactement ce que montre déjà
            // `drawTransition` à `mix === 1` pour une coupe (voir sa documentation).
            const holdBase = elapsed
            await holdFrame(
              () => drawSingle(ctx, next, { width, height }),
              holdMs,
              options.signal,
              (holdElapsed) => options.onProgress?.(holdBase + holdElapsed, totalMs),
            )
            elapsed = holdBase + holdMs
            options.onProgress?.(elapsed, totalMs)
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
      } finally {
        current.bitmap.close()
      }

      stopRecorder()
    })().catch(fail)
  })
}
