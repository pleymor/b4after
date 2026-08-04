import type { Size } from '@/types'
import { drawShot } from './drawShot'
import type { ComparisonInput } from './sideBySide'
import type { GifRequest, GifResponse } from './gif.worker'
import GifWorker from './gif.worker?worker'

export const GIF_MAX_WIDTH = 640
export const GIF_STEPS = 10
export const GIF_HOLD_MS = 500
export const GIF_STEP_MS = 80

function abortError(): DOMException {
  return new DOMException('Export annulé', 'AbortError')
}

/**
 * Fondu en `GIF_STEPS` frames de l avant vers l après, avec une pause aux deux
 * extrémités et une boucle infinie. Le retour se fait par coupe franche : doubler
 * les frames pour un fondu retour doublerait le poids du fichier sans rien apporter
 * à une comparaison avant/après.
 */
export async function renderCrossfadeGif(
  before: ComparisonInput,
  after: ComparisonInput,
  frame: Size,
  options: {
    onProgress?: (done: number, total: number) => void
    signal?: AbortSignal
  } = {},
): Promise<Blob> {
  if (options.signal?.aborted) throw abortError()

  // Contrairement à l export JPEG, c est la largeur seule qui borne le GIF : c est
  // elle qui détermine le poids du fichier au partage.
  const widthFactor = Math.min(1, GIF_MAX_WIDTH / frame.width)
  const width = Math.round(frame.width * widthFactor)
  const height = Math.round(frame.height * widthFactor)

  const canvas = new OffscreenCanvas(width, height)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Contexte 2D indisponible')

  const scaled = (input: ComparisonInput) => ({
    source: input.source,
    transform: {
      ...input.transform,
      tx: input.transform.tx * widthFactor,
      ty: input.transform.ty * widthFactor,
    },
    shot: {
      width: input.shot.width * widthFactor,
      height: input.shot.height * widthFactor,
    },
  })

  const from = scaled(before)
  const to = scaled(after)
  const frames: ArrayBuffer[] = []
  const delays: number[] = []

  for (let step = 0; step < GIF_STEPS; step += 1) {
    if (options.signal?.aborted) throw abortError()

    const mix = step / (GIF_STEPS - 1)
    ctx.clearRect(0, 0, width, height)
    ctx.globalAlpha = 1
    drawShot(ctx, from.source, from.transform, { width, height }, from.shot)
    if (mix > 0) {
      ctx.globalAlpha = mix
      drawShot(ctx, to.source, to.transform, { width, height }, to.shot)
      ctx.globalAlpha = 1
    }

    frames.push(ctx.getImageData(0, 0, width, height).data.buffer as ArrayBuffer)
    const isEdge = step === 0 || step === GIF_STEPS - 1
    delays.push(isEdge ? GIF_HOLD_MS : GIF_STEP_MS)
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
