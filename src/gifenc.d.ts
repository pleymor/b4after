/**
 * `gifenc` ne fournit aucune déclaration de types. On déclare ici la seule surface
 * que l export GIF utilise, telle que documentée dans son README.
 */
declare module 'gifenc' {
  /** Une palette est un tableau de triplets ou quadruplets de canaux. */
  export type Palette = number[][]

  export type PaletteFormat = 'rgb565' | 'rgb444' | 'rgba4444'

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    options?: { format?: PaletteFormat; oneBitAlpha?: boolean | number; clearAlpha?: boolean },
  ): Palette

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: PaletteFormat,
  ): Uint8Array

  export type GifEncoder = {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      options?: { palette?: Palette; delay?: number; repeat?: number; transparent?: boolean },
    ): void
    finish(): void
    /** Copie dimensionnée exactement au flux écrit. */
    bytes(): Uint8Array
    /** Vue sur le tampon interne, potentiellement plus grand que le flux. */
    bytesView(): Uint8Array
  }

  export function GIFEncoder(options?: { auto?: boolean }): GifEncoder
}
