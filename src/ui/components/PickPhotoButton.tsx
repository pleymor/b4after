import { useRef, type ChangeEvent } from 'react'
import { GalleryIcon } from './icons'

/**
 * Bouton discret, à côté du déclencheur, qui ouvre le sélecteur de photos du
 * téléphone. Reste actionnable même quand la caméra est refusée ou indisponible :
 * c est alors le seul moyen d alimenter l app, et le priver de ce cas serait absurde.
 *
 * Pas d attribut `capture` sur l input : il forcerait l appareil photo, l inverse du
 * but recherché.
 */
export function PickPhotoButton({ onPick }: { onPick: (file: File) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null)

  function onChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Sans cette remise à zéro, choisir deux fois le même fichier ne redéclencherait
    // pas onChange.
    event.target.value = ''
    if (file) onPick(file)
  }

  return (
    <>
      <button
        type="button"
        data-testid="pick-photo"
        aria-label="Choisir une photo existante"
        onClick={() => inputRef.current?.click()}
        className="absolute bottom-9 right-6 flex size-14 items-center justify-center rounded-full bg-slate-900/70 text-white"
      >
        <GalleryIcon />
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        data-testid="pick-photo-input"
        onChange={onChange}
        className="hidden"
      />
    </>
  )
}
