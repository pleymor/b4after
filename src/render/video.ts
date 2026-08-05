import type { Size } from '@/types'
import { drawTransition, scaleInput, transitionSteps } from './crossfade'
import { GIF_HOLD_MS, GIF_MAX_WIDTH, GIF_STEP_MS } from './gif'
import type { ComparisonInput } from './sideBySide'

// Même borne que le GIF (voir gif.ts) : c est la largeur qui fixe le poids du
// fichier au partage, et les deux exports doivent se comporter pareil sur ce point.
export const VIDEO_MAX_WIDTH = GIF_MAX_WIDTH

const VIDEO_MIME_CANDIDATES = ['video/mp4;codecs=avc1.42E01E', 'video/mp4']

// Nombre de fondus enchaînés joués à la suite. Un seul aller (avant → après) ne
// dure que le temps d une prise + un fondu, soit environ 1,1 s : assez court pour
// qu une seule lecture ressemble à un instantané figé plutôt qu à une animation.
// En jouer trois, en va-et-vient, porte la durée totale à environ 3,4 s.
const REPS = 3

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
 * Fondu enchaîné en va-et-vient (avant → après → avant → …) dessiné en temps réel
 * sur un canevas détaché, capturé et encodé par `MediaRecorder`. Même rythme que
 * `renderCrossfadeGif` (paliers de 500 ms, pas de fondu de 80 ms) pour que les deux
 * exports se ressemblent, mais rejoué `REPS` fois pour qu une seule lecture se lise
 * déjà comme une animation plutôt qu un clignement.
 */
export async function renderCrossfadeVideo(
  before: ComparisonInput,
  after: ComparisonInput,
  frame: Size,
  options: {
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
  } = {},
): Promise<Blob> {
  if (options.signal?.aborted) throw abortError()

  const mime = supportedVideoMime()
  if (!mime) throw new Error('Aucun format vidéo pris en charge')

  const widthFactor = Math.min(1, VIDEO_MAX_WIDTH / frame.width)
  const width = Math.round(frame.width * widthFactor)
  const height = Math.round(frame.height * widthFactor)

  const from = scaleInput(before, widthFactor)
  const to = scaleInput(after, widthFactor)
  const fadeSteps = transitionSteps('crossfade')

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

  const total = REPS * (1 + fadeSteps)

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
      for (let rep = 0; rep < REPS; rep += 1) {
        const target = 1 - mix

        drawTransition(ctx, from, to, { width, height }, mix, 'crossfade')
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
            'crossfade',
          )
          await wait(GIF_STEP_MS, options.signal)
          done += 1
          options.onProgress?.(done, total)
        }

        mix = target
      }

      stopRecorder()
    })().catch(fail)
  })
}
