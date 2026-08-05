# Retour instantané à la prise de vue

Date : 2026-08-05

## Problème

Sur mobile, plusieurs secondes s'écoulent entre la tape sur le déclencheur et
l'apparition de la photo prise. Rien ne bouge à l'écran pendant ce temps : ni flash, ni
gel de l'image, ni indicateur. L'utilisateur ne sait pas si sa tape a été prise en
compte et est tenté de retaper.

La cause est dans `capture()` (`src/camera/useCamera.ts`) : trois opérations lourdes
s'enchaînent **avant** que l'interface ne change quoi que ce soit.

1. `toJpegBlob(video, …)` — encodage JPEG pleine résolution, qualité 0,9.
2. `createImageBitmap(blob)` — décodage complet de ce qui vient d'être encodé.
3. `makeThumbnail(bitmap, …)` — second encodage JPEG.

Puis, dans le flux « reprise », `AlignScreen` décode le blob une **troisième** fois via
`useBitmap` avant de dessiner le premier pixel.

Or l'image à afficher est disponible dès la tape : elle est dans la vidéo. Tout ce
travail sert à la *persistance*, pas à l'*affichage*, et n'a aucune raison de le
précéder.

## Principe

Séparer la saisie de l'encodage.

- **Saisie** — synchrone, dans le gestionnaire de tape : dessiner la trame vidéo dans un
  `OffscreenCanvas`. Aucun `await`, donc la photo affichée est exactement celle de
  l'instant de la tape.
- **Encodage** — démarré en arrière-plan, attendu seulement au moment d'enregistrer.

Le canvas saisi est déjà un `Drawable` (`src/render/drawShot.ts` accepte
`OffscreenCanvas`) : il s'affiche et s'encode directement, sans passer par un blob. Le
`createImageBitmap` intermédiaire disparaît donc complètement — deux opérations lourdes
au lieu de trois, et aucune sur le chemin de l'affichage.

## Architecture

### `src/capture/pendingEncode.ts` (nouveau)

Encapsule « un travail démarré tôt, attendu tard, réessayable ».

```ts
export type PendingEncode = {
  isDone: () => boolean
  result: () => Promise<EncodedFrame>
}
export function startEncoding(encode: () => Promise<EncodedFrame>): PendingEncode
```

- L'encodage démarre à la construction.
- Un rejet remet la promesse à `null` : un nouvel appel à `result()` relance l'encodage.
  Sans ça, un échec transitoire condamnerait la photo — « Enregistrer » retomberait
  éternellement sur la même promesse rejetée.
- Un `catch` neutre est attaché dès le départ : tant que personne n'attend le résultat,
  un rejet ne doit pas remonter en `unhandledrejection`.

Logique pure, testée en unitaire.

### `src/capture/flash.ts` (nouveau)

Petit magasin externe (`subscribeFlash` / `isFlashing` / `triggerFlash`) consommé par
`useSyncExternalStore`.

Il est **hors du routeur** parce que le flux « reprise » navigue vers le calage
immédiatement après la tape : un flash rendu par l'écran caméra serait démonté avant
d'être vu. `<CaptureFlash />` est monté une fois dans `App`, au-dessus des routes, et
survit donc à la navigation.

Durée : 220 ms, fondu du blanc vers le transparent. Sous
`prefers-reduced-motion: reduce`, le voile reste mais ne fond pas : c est le seul retour
visuel de la tape, le supprimer priverait ces utilisateurs du repère lui-même, pas d une
fioriture.

### `src/render/encodeFrame.ts` (nouveau)

`encodeFrame(source, size)` → `{ blob, thumbBlob }`. Réutilise `toJpegBlob` et
`makeThumbnail` en leur passant directement le canvas saisi.

### `src/camera/useCamera.ts` (modifié)

`capture()` devient synchrone et rend :

```ts
export type CapturedFrame = {
  source: OffscreenCanvas
  width: number
  height: number
  encoding: PendingEncode
}
```

Elle déclenche le flash, dessine la trame, lance l'encodage, et rend. Aucun `await`.

### `src/ui/components/BusyStatus.tsx` (nouveau)

Remplace le bouton d'action par un rond tournant et un libellé décrivant l'étape en
cours. Choix de l'utilisateur : plutôt qu'un bouton grisé — qui se lit comme une
interface cassée — le bouton disparaît et cède la place à l'état réel
(« Encodage de la photo… », puis « Enregistrement… »).

### Écrans

- **`FirstCaptureScreen`** — le canvas saisi s'affiche via `ShotCanvas` (transformation
  identité, cadre = dimensions de la photo), en conservant le `data-testid`
  `captured-preview`. La feuille de nommage apparaît dans le même rendu.
- **`RetakeCaptureScreen`** — flash, `setPendingShot`, navigation immédiate vers le
  calage. Plus aucun `await` entre la tape et la navigation.
- **`AlignScreen`** — dessine `pending.captured.source` au lieu de décoder le blob ; le
  troisième décodage disparaît. `onConfirm` attend `encoding.result()` avant
  `addShot`.

  Pendant l enregistrement, les actions secondaires (« Permuter », « Remettre à zéro »,
  « Reprendre ») sont retirées avec le bouton. « Reprendre » consomme la photo en
  attente : l attente de l encodage allonge la fenêtre pendant laquelle une tape la
  ferait disparaître sous l écriture en cours.

## Flux de données

```
tape → triggerFlash()
     → drawImage(video) dans un OffscreenCanvas   [synchrone]
     → startEncoding(...)                         [arrière-plan]
     → rendu : flash + image gelée                [prochaine peinture]
       ...
     → tape sur Enregistrer / Valider
     → BusyStatus « Encodage de la photo… »       [si encore en cours]
     → await encoding.result()
     → BusyStatus « Enregistrement… »
     → addShot / createViewpointWithFirstShot
```

## Erreurs

- **Saisie impossible** (`videoWidth` à zéro, pas de contexte 2D) : `capture()` lève,
  l'écran affiche « La capture a échoué. Réessayez. » et le flux reste actif.
- **Encodage en échec** : message d'erreur sur l'écran d'enregistrement, la photo reste
  en attente, un nouvel appui relance un encodage neuf (voir `pendingEncode`).
- **Quota dépassé** : comportement actuel inchangé.

## Tests

Unitaires (`vitest`, environnement node) :

- `pendingEncode` — démarrage immédiat, `isDone` après résolution, relance après rejet,
  pas de rejet non géré quand personne n'attend.
- `flash` — `triggerFlash` active puis désactive après `FLASH_MS`, notification des
  abonnés, désabonnement effectif.

End-to-end (`playwright`) : `OffscreenCanvas.prototype.convertToBlob` est ralenti
artificiellement à 2 s via `addInitScript`. C'est ce qui rend la régression détectable —
avec l'ancien code, l'aperçu ne pouvait pas apparaître avant la fin de l'encodage.

- L'aperçu gelé apparaît en moins d'une seconde alors que l'encodage est encore en
  cours, dans les deux flux (première photo et reprise).
- Le flash s'active (observateur de mutations posé **avant** la tape, pour ne pas
  courir après une animation de 220 ms).
- « Enregistrer » pendant l'encodage : le bouton cède la place au libellé d'étape, et
  l'enregistrement aboutit.

La suite e2e existante encadre le reste : `captured-preview` doit rester visible, la
piste caméra doit toujours être réellement coupée à la tape, et « Reprendre » doit
relancer le flux.

## Hors périmètre

- Déplacer l'encodage dans un worker. L'affichage n'attend plus l'encodage : le gain
  résiduel ne justifie pas le transfert de canvas ni la complexité.
- Toucher aux exports (`CompareScreen`, MP4/GIF) : ils partent des blobs stockés.
