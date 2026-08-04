/// <reference lib="webworker" />

import { GIFEncoder, applyPalette, quantize } from 'gifenc'

export type GifRequest = {
  /** Une entrée par frame : les pixels RGBA bruts, transférés sans copie. */
  frames: ArrayBuffer[]
  delays: number[]
  width: number
  height: number
}

export type GifResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'done'; bytes: ArrayBuffer }
  | { type: 'error'; message: string }

function post(message: GifResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer)
}

self.onmessage = (event: MessageEvent<GifRequest>) => {
  const { frames, delays, width, height } = event.data
  try {
    const encoder = GIFEncoder()

    frames.forEach((buffer, index) => {
      const pixels = new Uint8Array(buffer)
      // Une palette par frame : le fondu passe par des teintes intermédiaires
      // qu une palette partagée rendrait en bandes visibles.
      const palette = quantize(pixels, 256)
      const indexed = applyPalette(pixels, palette)
      encoder.writeFrame(indexed, width, height, {
        palette,
        delay: delays[index],
        repeat: 0,
      })
      post({ type: 'progress', done: index + 1, total: frames.length })
    })

    encoder.finish()
    const bytes = encoder.bytes()
    post({ type: 'done', bytes: bytes.buffer as ArrayBuffer }, [bytes.buffer as ArrayBuffer])
  } catch (error) {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
}
