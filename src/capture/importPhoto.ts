import type { CapturedFrame } from '@/camera/useCamera'
import { startEncoding } from '@/capture/pendingEncode'
import { encodeFrame } from '@/render/encodeFrame'

/**
 * Transforme un fichier choisi dans la galerie en `CapturedFrame`, la même structure
 * que rend `useCamera.capture()` : le reste du parcours (feuille de nommage, écran de
 * calage) ne fait ainsi aucune différence entre une photo prise et une photo importée.
 *
 * Le décodage applique l orientation EXIF puis le ré-encodage la fige en JPEG — plus
 * aucun consommateur n a à s en soucier ensuite. `imageOrientation: 'from-image'` est
 * ce qui porte ce traitement ; non vérifié ici sur un vrai fichier EXIF, seulement sur
 * un téléphone.
 *
 * Un fichier illisible (format non pris en charge, fichier corrompu) fait échouer
 * `createImageBitmap` : l erreur remonte telle quelle, à l appelant de l afficher.
 */
export async function importPhoto(file: File): Promise<CapturedFrame> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const { width, height } = bitmap

  const source = new OffscreenCanvas(width, height)
  const ctx = source.getContext('2d')
  if (!ctx) throw new Error('Contexte 2D indisponible')
  ctx.drawImage(bitmap, 0, 0, width, height)
  // Le bitmap décodé ne sert plus une fois dessiné dans le canvas.
  bitmap.close()

  return {
    source,
    width,
    height,
    encoding: startEncoding(() => encodeFrame(source, { width, height })),
  }
}
