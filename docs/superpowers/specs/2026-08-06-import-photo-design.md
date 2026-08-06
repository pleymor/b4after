# Choisir une photo existante

Date : 2026-08-06

## Problème

L'app impose de prendre la photo dans l'app. Or l'avant existe souvent déjà : on
photographie un chantier pendant des semaines avec l'appareil photo du téléphone, puis
on installe b4after — et il faut repartir de zéro, la première photo prise dans l'app
devenant la référence.

## Principe

À côté du déclencheur, un bouton discret ouvre le sélecteur de photos du téléphone. La
prise de vue reste l'action principale, au centre.

Une photo importée suit exactement le même chemin qu'une photo prise :

- **Photo de référence** : elle définit le cadre canonique par ses dimensions, puis on
  saisit le nom. Identique à une prise.
- **Reprise** : elle devient la photo en attente et on part à l'écran de calage, où le
  fantôme de référence est déjà affiché. Le calage à deux doigts fait le reste — ce qui
  compense l'absence de superposition en direct au moment de la prise.

C'est ce qui rend la fonctionnalité peu coûteuse : `clampToCover` place déjà une photo
de dimensions quelconques dans le cadre canonique, et l'écran de calage ne fait aucune
hypothèse sur la provenance de la photo.

## Normalisation

`src/capture/importPhoto.ts` (nouveau) transforme un `File` en `CapturedFrame`, la même
structure que rend `useCamera.capture()` :

1. Décodage par `createImageBitmap(file, { imageOrientation: 'from-image' })`.
2. Ré-encodage en JPEG qualité 0.9 par `toJpegBlob`, aux dimensions du bitmap décodé.
3. Vignette par `makeThumbnail`.

Les trois étapes réutilisent le code existant.

**Pourquoi ré-encoder plutôt que stocker le fichier tel quel.** Trois raisons, et
chacune suffirait :

- **L'orientation EXIF.** Les photos de galerie portent une rotation dans leurs
  métadonnées, ce que la caméra en direct ne produit jamais. Sans traitement, une photo
  prise en portrait s'afficherait couchée. Le décodage l'applique, le ré-encodage la
  fige : plus aucun consommateur n'a à s'en soucier.
- **Le format.** Un iPhone produit du HEIC, que tous les navigateurs ne décodent pas.
  Ré-encoder normalise ce qui entre en base.
- **L'homogénéité.** Tout le stockage est en JPEG 0.9 ; une exception créerait des cas
  particuliers en aval.

Si le décodage échoue — format non pris en charge, fichier corrompu — un message
français explicite s'affiche, et rien n'est écrit.

## Interface

Sur les deux écrans de capture, à côté du déclencheur : un bouton d'icône
`data-testid="pick-photo"` de libellé accessible « Choisir une photo existante », qui
déclenche un `<input type="file" accept="image/*">` masqué,
`data-testid="pick-photo-input"`.

L'attribut `capture` n'est **pas** posé : sa présence forcerait l'appareil photo, ce
qui est exactement l'inverse du but.

Le bouton reste actionnable même quand la caméra est refusée ou indisponible — c'est
alors le seul moyen d'alimenter l'app, et le priver de ce cas serait absurde.

## Non-objectifs

- Pas d'import multiple : une photo à la fois, comme une prise.
- Pas de lecture des dates EXIF pour dater la photo. La date reste celle de l'ajout,
  comme aujourd'hui — la changer toucherait au tri des séries et à la sélection
  avant/après, pour un gain qui n'est pas demandé.

## Tests

- Rendu : `importPhoto` sur une image connue rend un `CapturedFrame` en JPEG, aux
  dimensions de la source, avec une vignette ; un fichier illisible est rejeté par une
  erreur et non par un plantage.
- Parcours : sur l'écran de référence, choisir un fichier via `setInputFiles` amène la
  feuille de nommage, et enregistrer crée un point de vue dont le cadre canonique vaut
  les dimensions du fichier importé.
- Parcours : sur l'écran de reprise, choisir un fichier amène à l'écran de calage sans
  rien écrire en base avant validation — l'invariant tenu pour une prise doit valoir
  pour un import.
- L'orientation EXIF n'est **pas** couverte automatiquement : fabriquer un fixture JPEG
  porteur d'une balise d'orientation est disproportionné ici. `imageOrientation:
  'from-image'` la traite, mais le dire est plus honnête que de l'affirmer sans preuve.
  À vérifier sur un vrai téléphone, avec les deux autres comportements caméra déjà en
  attente de validation sur appareil.
