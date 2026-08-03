/** Place les pixels d'une photo dans le cadre canonique de son point de vue. */
export type Transform = {
  /** Facteur d'échelle, jamais inférieur au `scaleMin` calculé. */
  scale: number
  /** Radians, borné à ±MAX_ROTATION. */
  rotation: number
  /** Translation en pixels du cadre canonique, exprimée dans le repère écran. */
  tx: number
  ty: number
}

export type Size = { width: number; height: number }

export type Viewpoint = {
  id: string
  name: string
  createdAt: number
  /** Cadre canonique : dimensions natives de la première photo du point de vue. */
  frameWidth: number
  frameHeight: number
}

export type Shot = {
  id: string
  viewpointId: string
  takenAt: number
  /** JPEG plein format, tel que capturé. Jamais réécrit. */
  blob: Blob
  thumbBlob: Blob
  width: number
  height: number
  transform: Transform
}

export type ViewpointSummary = Viewpoint & {
  shotCount: number
  lastShotAt: number | null
  coverThumb: Blob | null
}
