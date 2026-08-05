import { useCallback, useState } from 'react'
import {
  loadExportOptions,
  saveExportOptions,
  type ExportOptions,
  type ImageOptions,
  type VideoOptions,
} from '@/lib/exportOptions'

export type ExportOptionsPatch = {
  image?: Partial<ImageOptions>
  video?: Partial<VideoOptions>
}

/**
 * Options d export mémorisées. Le patch est fusionné champ par champ dans la section
 * visée : une feuille ne peut donc pas effacer un réglage qu elle n affiche pas.
 */
export function useExportOptions(): [ExportOptions, (patch: ExportOptionsPatch) => void] {
  // Initialiseur paresseux : la lecture de `localStorage` ne doit avoir lieu qu au
  // montage, pas à chaque rendu.
  const [options, setOptions] = useState<ExportOptions>(loadExportOptions)

  const update = useCallback((patch: ExportOptionsPatch) => {
    setOptions((current) => {
      const next: ExportOptions = {
        image: { ...current.image, ...patch.image },
        video: { ...current.video, ...patch.video },
      }
      saveExportOptions(next)
      return next
    })
  }, [])

  return [options, update]
}
