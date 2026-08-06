import type { Transition, VideoWidth } from '@/lib/exportOptions'
import type { Size } from '@/types'
import { decodeScaled, drawSingle, drawTransition, scaleInput, targetWidth, transitionSteps } from './crossfade'
import type { ComparisonInput } from './sideBySide'
import type { GifRequest, GifResponse } from './gif.worker'
import GifWorker from './gif.worker?worker'

export const GIF_MAX_WIDTH = 640
export const GIF_STEPS = 10
export const GIF_HOLD_MS = 500
export const GIF_STEP_MS = 80

// Plafond du chemin GIF, plus bas que celui de la vidéo (`EXPORT_MAX_EDGE`, 2048) :
// contrairement à `MediaRecorder`, qui encode au fil de l eau, ce chemin accumule en
// mémoire les frames RGBA brutes de chaque palier avant de les poster au worker — environ
// 83 Mo à 1920x1080 contre 10 Mo à 640 px, et la quantification tourne sur autant de
// pixels par frame. Et c est précisément le repli des navigateurs sans MP4, donc des
// appareils les plus faibles : un GIF moins large qu attendu en qualité maximale est un
// moindre mal face à un onglet qui meurt.
export const GIF_WIDTH_CAP = 1080

function abortError(): DOMException {
  return new DOMException('Export annulé', 'AbortError')
}

/**
 * Parcourt toute la série dans l ordre : palier sur la photo 1, transition, palier
 * sur la photo 2, … jusqu à la dernière, puis boucle à l infini. Le retour au début se
 * fait par coupe franche quelle que soit la transition choisie : doubler les frames
 * pour un retour animé doublerait le poids du fichier sans rien apporter à une
 * comparaison avant/après (voir la spec de comparaison de série).
 *
 * Décode une photo à la fois : au plus deux bitmaps vivants en même temps (celui
 * qu on quitte et celui qu on rejoint), jamais toute la série (voir la spec, § Mémoire).
 */
export async function renderCrossfadeGif(
  inputs: ComparisonInput[],
  frame: Size,
  options: {
    transition?: Transition
    width?: VideoWidth
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
  } = {},
): Promise<Blob> {
  if (options.signal?.aborted) throw abortError()

  const transition = options.transition ?? 'crossfade'
  // Frames de transition entre deux paliers immobiles : une coupe franche n en a
  // aucune.
  const innerSteps = transitionSteps(transition)
  const gaps = inputs.length - 1
  // Un palier par photo, plus les frames de transition de chaque intervalle.
  const totalFrames = 1 + gaps * (innerSteps + 1)

  // `GIF_WIDTH_CAP` prime même sur `'full'` : voir sa déclaration plus haut. Et le
  // plafond n est jamais franchi vers le haut, dans un sens comme dans l autre : un
  // export n agrandit pas.
  const requestedWidth = Math.min(targetWidth(options.width ?? GIF_MAX_WIDTH, frame), GIF_WIDTH_CAP)
  const widthFactor = Math.min(1, requestedWidth / frame.width)
  const width = Math.round(frame.width * widthFactor)
  const height = Math.round(frame.height * widthFactor)

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Contexte 2D indisponible')

  const scaled = inputs.map((input) => scaleInput(input, widthFactor))
  const frames: ArrayBuffer[] = []
  const delays: number[] = []

  // `isHold` : un palier sur une photo dure `GIF_HOLD_MS`, une frame de transition
  // seulement `GIF_STEP_MS`.
  function pushFrame(isHold: boolean) {
    frames.push(ctx!.getImageData(0, 0, width, height).data.buffer as ArrayBuffer)
    delays.push(isHold ? GIF_HOLD_MS : GIF_STEP_MS)
    options.onProgress?.(frames.length, totalFrames)
  }

  let from = await decodeScaled(scaled[0])
  try {
    if (options.signal?.aborted) throw abortError()
    drawSingle(ctx, from, { width, height })
    pushFrame(true)

    for (let gap = 0; gap < gaps; gap += 1) {
      if (options.signal?.aborted) throw abortError()
      const to = await decodeScaled(scaled[gap + 1])
      try {
        for (let step = 1; step <= innerSteps; step += 1) {
          if (options.signal?.aborted) throw abortError()
          const mix = step / (innerSteps + 1)
          drawTransition(ctx, from, to, { width, height }, mix, transition)
          pushFrame(false)
        }
        // Palier sur la photo suivante : ferme l intervalle qui vient de se jouer, et
        // sert aussi de départ au suivant — on ne le dessine donc qu une fois.
        drawTransition(ctx, from, to, { width, height }, 1, transition)
        pushFrame(true)
      } catch (error) {
        // `from` est fermé par le `finally` ci-dessous : sur cette branche d erreur,
        // c est `to` qu il faut fermer nous-mêmes, faute de quoi il ne serait jamais
        // réassigné à `from` et resterait ouvert.
        to.bitmap.close()
        throw error
      } finally {
        from.bitmap.close()
      }
      from = to
    }
  } finally {
    from.bitmap.close()
  }

  return encodeInWorker({ frames, delays, width, height }, options)
}

function encodeInWorker(
  request: GifRequest,
  options: { onProgress?: (done: number, total: number) => void; signal?: AbortSignal },
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const worker = new GifWorker()

    const cleanup = () => {
      worker.terminate()
      options.signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(abortError())
    }
    options.signal?.addEventListener('abort', onAbort)

    worker.onmessage = (event: MessageEvent<GifResponse>) => {
      const message = event.data
      if (message.type === 'progress') {
        options.onProgress?.(message.done, message.total)
        return
      }
      cleanup()
      if (message.type === 'done') {
        resolve(new Blob([message.bytes], { type: 'image/gif' }))
      } else {
        reject(new Error(message.message))
      }
    }

    worker.onerror = (event) => {
      cleanup()
      reject(new Error(event.message || 'Échec de l encodage GIF'))
    }

    worker.postMessage(request, request.frames)
  })
}
