import type { Transition, VideoLength, VideoWidth } from '@/lib/exportOptions'
import type { Size } from '@/types'
import { drawTransition, scaleInput, targetWidth, transitionSteps } from './crossfade'
import { GIF_HOLD_MS, GIF_MAX_WIDTH, GIF_STEP_MS } from './gif'
import type { ComparisonInput } from './sideBySide'

// Même défaut que le GIF (voir gif.ts), pas un plafond : le vrai plafond commun aux
// deux exports est EXPORT_MAX_EDGE, appliqué dans targetWidth.
export const VIDEO_MAX_WIDTH = GIF_MAX_WIDTH

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
 * Transition (fondu, coupe ou balayage) de l avant vers l après, en va-et-vient
 * (avant → après → avant → …), dessinée en temps réel sur un canevas détaché, capturée
 * et encodée par `MediaRecorder`. Même rythme que `renderCrossfadeGif` (paliers de
 * 500 ms, pas de transition de 80 ms) pour que les deux exports se ressemblent, mais
 * rejouée le nombre de fois spécifié par `reps` pour qu une seule lecture se lise déjà
 * comme une animation plutôt qu un clignement.
 */
export async function renderCrossfadeVideo(
  before: ComparisonInput,
  after: ComparisonInput,
  frame: Size,
  options: {
    transition?: Transition
    width?: VideoWidth
    reps?: VideoLength
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
  const fadeSteps = transitionSteps(transition)

  // Trois allers-retours par défaut, soit environ 3,4 s : un seul aller ne dure que
  // le temps d'une prise plus un fondu (~1,1 s) et se lit comme un instantané figé
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
  // la cadence dépend du navigateur, ce qui marche aujourd hui parce que nos
  // paliers de 80 à 500 ms laissent largement le temps d un repaint, mais rien ne
  // le garantit — et c est aussi par là qu une image finale pourrait se perdre.
  // À 30 im/s le flux échantillonne le canevas à cadence fixe ; les longues
  // plages immobiles ne coûtent presque rien, H.264 les compresse en quasi-rien.
  const stream = canvas.captureStream(30)
  const recorder = new MediaRecorder(stream, { mimeType: mime })
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data)
  }

  // Pour une coupe franche (`fadeSteps === 0`), la boucle ne dessine que le palier de
  // *départ* de chaque aller-retour ; l état atteint après le dernier aller-retour n
  // est donc jamais dessiné par la boucle elle-même (voir plus bas). D où le `+ 1` :
  // sans lui la barre de progression n atteindrait jamais 100 %.
  const total = fadeSteps === 0 ? reps + 1 : reps * (1 + fadeSteps)

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
      let done = 0
      let mix = 0
      for (let rep = 0; rep < reps; rep += 1) {
        const target = 1 - mix

        drawTransition(ctx, from, to, { width, height }, mix, transition)
        await wait(GIF_HOLD_MS, options.signal)
        done += 1
        options.onProgress?.(done, total)

        for (let step = 1; step <= fadeSteps; step += 1) {
          drawTransition(
            ctx,
            from,
            to,
            { width, height },
            mix + (target - mix) * (step / fadeSteps),
            transition,
          )
          await wait(GIF_STEP_MS, options.signal)
          done += 1
          options.onProgress?.(done, total)
        }

        mix = target
      }

      // Coupe franche : `fadeSteps` vaut 0, donc la boucle ci-dessus n a dessiné que
      // les paliers de *départ* de chaque aller-retour, jamais l état atteint après le
      // dernier. Sans ce palier, la vidéo s arrêterait sur le dernier avant affiché et
      // ne montrerait jamais l après, même si `mix` vaut bien `target` à ce point.
      // `crossfade` et `wipe` n en ont pas besoin : leur dernière frame de transition
      // dessine déjà `mix = target`.
      if (fadeSteps === 0) {
        drawTransition(ctx, from, to, { width, height }, mix, transition)
        await wait(GIF_HOLD_MS, options.signal)
        done += 1
        options.onProgress?.(done, total)
      }

      stopRecorder()
    })().catch(fail)
  })
}
