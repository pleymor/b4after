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
  /**
   * Rang dans la série, croissant. Détaché de `takenAt` : l'ordre est réordonnable à
   * la main, et c'est lui — jamais la date — qui décide de la suite affichée,
   * comparée, exportée, et de la photo qui sert de fantôme à la prise suivante.
   *
   * Les rangs sont contigus après un réordonnancement, mais une suppression les
   * laisse troués : seul l'ordre relatif compte.
   */
  order: number
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
