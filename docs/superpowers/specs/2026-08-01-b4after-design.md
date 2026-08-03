# b4after — PWA de comparaison avant/après

**Date :** 2026-08-01
**Statut :** design validé, prêt pour le plan d'implémentation

## Problème

Sur un chantier, on veut documenter l'avancement en reprenant périodiquement la même photo du même endroit. Sans repère, les clichés successifs ne se superposent jamais et la comparaison avant/après perd son effet. b4after est une PWA smartphone qui aide à retrouver l'angle d'une photo précédente, puis produit une comparaison partageable.

## Périmètre

**Dans la v1 :**

- Créer des points de vue et y accumuler des photos datées
- Aide au cadrage par calque fantôme semi-transparent sur le flux caméra
- Calage fin après la prise (pincer / déplacer / pivoter) pour superposer exactement
- Comparaison de deux photos d'une même série
- Export en image côte-à-côte (JPEG) et en GIF animé, partagés via le partage natif
- Fonctionnement hors ligne, données 100 % locales

**Hors périmètre (non-objectifs explicites) :**

- Comptes utilisateurs, synchronisation multi-appareil, partage par lien
- Regroupement des points de vue par chantier ou par dossier
- Rapport PDF, timelapse de toute la série
- Guidage par capteurs (boussole, inclinaison), détection de contours, recalage automatique
- Internationalisation — l'interface est en français uniquement
- Retouche photo (luminosité, filtres, recadrage destructif)

## Cible

Android Chrome en priorité. iOS Safari doit rester fonctionnel mais n'est pas la cible d'optimisation ni de validation. Aucun support desktop spécifique : l'app doit simplement ne pas casser sur un écran large.

## Stack

Vite + React + TypeScript, Tailwind pour le style, `vite-plugin-pwa` pour le manifeste et le service worker, `idb` pour IndexedDB, `gifenc` pour l'encodage GIF, `react-router` pour la navigation (le bouton retour Android doit fonctionner). Vitest pour les tests unitaires, Playwright pour les tests de rendu et de parcours.

## Modèle de données

Deux entités, stockées dans IndexedDB.

```ts
type Transform = {
  scale: number      // ≥ scaleMin calculé, jamais en dessous
  rotation: number   // radians, borné à ±15°
  tx: number         // translation en pixels du cadre canonique
  ty: number
}

type Viewpoint = {
  id: string         // crypto.randomUUID()
  name: string
  createdAt: number  // epoch ms
  frameWidth: number   // cadre canonique, défini par la première photo
  frameHeight: number
}

type Shot = {
  id: string
  viewpointId: string
  takenAt: number
  blob: Blob         // JPEG plein format, tel que capturé
  thumbBlob: Blob    // JPEG ~320 px sur le plus grand côté, qualité 0.7
  width: number      // dimensions natives du blob
  height: number
  transform: Transform
}
```

**Object stores :** `viewpoints` (clé `id`) et `shots` (clé `id`, index `by-viewpoint` sur `[viewpointId, takenAt]`). L'index composite permet de lister une série triée sans charger les blobs des autres points de vue.

### Cadre canonique

Le cadre canonique d'un point de vue est `frameWidth × frameHeight`, soit les dimensions natives de sa première photo. La `transform` d'un `Shot` place ses pixels dans ce cadre. La première photo porte la transformation identité (`scale: 1, rotation: 0, tx: 0, ty: 0`).

Toutes les photos d'un point de vue se rendent donc dans un rectangle identique. Aperçu, comparaison et exports partagent une seule primitive de dessin, sans cas particulier.

Les pixels d'origine ne sont jamais recadrés ni réécrits : seule la transformation est stockée. Le calage reste donc réversible et non destructif.

### Rendu d'une photo

```
ctx.translate(W/2 + tx, H/2 + ty)
ctx.rotate(rotation)
ctx.scale(scale, scale)
ctx.drawImage(bitmap, -w/2, -h/2, w, h)
```

où `W × H` est le cadre canonique et `w × h` les dimensions natives de la photo.

### Contrainte de couverture

La transformation est contrainte pour que l'image couvre toujours entièrement le cadre — aucun coin vide ne peut apparaître dans un export.

Dans le repère tourné de l'image, le cadre canonique occupe une boîte englobante de :

```
Wbb = W·|cos θ| + H·|sin θ|
Hbb = W·|sin θ| + H·|cos θ|
```

D'où l'échelle minimale : `scaleMin = max(Wbb / w, Hbb / h)`.

La translation est bornée dans ce même repère tourné : `|dx'| ≤ (scale·w − Wbb) / 2` et `|dy'| ≤ (scale·h − Hbb) / 2`, puis ramenée dans le repère écran par la rotation inverse.

Cette borne s'appuie sur la boîte englobante, elle est donc légèrement conservatrice : à forte rotation, elle interdit quelques positions pourtant valides. C'est un compromis assumé — la formule exacte n'apporte rien à ±15° et complique le code.

La rotation est bornée à ±15°. `scaleMin` et les bornes de translation sont recalculés à chaque geste, puisqu'ils dépendent de la rotation courante.

## Parcours utilisateur

### 1. Liste des points de vue

Écran d'accueil. Chaque ligne montre la vignette de la dernière photo, le nom, le nombre de photos et la date du dernier cliché, triée par cliché le plus récent. Bouton « Nouveau point de vue ». Accès aux réglages.

État vide : un texte d'accueil expliquant le principe et le bouton de création.

### 2. Première photo

Caméra plein écran, sans fantôme. Contraintes demandées : `facingMode: { ideal: 'environment' }`, `width: { ideal: 1920 }`, `height: { ideal: 1080 }`.

La capture dessine la frame courante du `<video>` sur un canvas aux dimensions `videoWidth × videoHeight`, puis exporte en JPEG qualité 0.9. Pas d'`ImageCapture` : le support est trop irrégulier.

Ces dimensions deviennent le cadre canonique. Une feuille de saisie demande ensuite le nom, pré-rempli avec « Point de vue N ».

### 3. Reprise d'une photo

Caméra avec le fantôme de **la dernière photo** de la série par-dessus le flux, plus un slider d'opacité (défaut 50 %). On prend la dernière plutôt que la première parce que la scène a évolué et que la plus récente est la plus reconnaissable ; géométriquement les deux sont équivalentes, puisque le fantôme est rendu dans le cadre canonique.

Les contraintes de capture ajoutent `aspectRatio: { ideal: frameWidth / frameHeight }`.

Si l'orientation de l'écran ne correspond pas à celle du cadre canonique (portrait contre paysage), un bandeau invite à tourner le téléphone avant de déclencher. On ne bloque pas le déclencheur : l'utilisateur reste maître.

### 4. Calage

La photo prise est affichée sous le fantôme de la référence. Gestes : un doigt pour déplacer, deux doigts pour l'échelle et la rotation. Slider d'opacité, bouton « permuter » qui intervertit les deux calques pour vérifier la superposition, boutons « Valider » et « Reprendre ».

La transformation initiale est l'identité, ajustée à `scaleMin` si nécessaire.

La photo n'est écrite en base qu'à la validation. « Reprendre » revient à l'écran caméra et jette le cliché.

### 5. Détail du point de vue

La série en timeline chronologique, vignettes et dates. On désigne une photo « avant » et une photo « après », puis « Comparer ». Par défaut, la plus ancienne et la plus récente sont présélectionnées.

Depuis cet écran : renommer le point de vue, supprimer une photo, supprimer le point de vue (avec confirmation), reprendre une photo.

Supprimer la première photo d'une série ne change pas le cadre canonique : il reste porté par le `Viewpoint`, indépendamment des photos existantes.

### 6. Comparaison

Aperçu avec une poignée verticale de révélation, qui sert à vérifier le calage avant d'exporter. Deux boutons : « Image côte-à-côte » et « GIF animé ». Une bascule permet d'afficher ou non les dates sur l'export.

### 7. Réglages

Un écran minimal : espace consommé et quota (`navigator.storage.estimate()`), état de la persistance du stockage avec un bouton pour la redemander si elle a été refusée, rappel que les données sont locales, et numéro de version de l'app.

## Architecture

Chaque module a une seule responsabilité et une frontière explicite.

### `src/db/`

Seule couche qui touche IndexedDB, via `idb`. Expose des fonctions de données, jamais l'objet base : `createViewpoint`, `renameViewpoint`, `deleteViewpoint`, `listViewpoints`, `getViewpoint`, `addShot`, `listShots`, `getShot`, `deleteShot`.

`listViewpoints` retourne les points de vue enrichis du nombre de photos, de la vignette et de la date du dernier cliché, pour que l'écran d'accueil n'ait aucune agrégation à faire.

Dépendances : `idb` uniquement. Testable sans navigateur.

### `src/camera/`

Un hook `useCamera(constraints)` qui possède le cycle de vie du `MediaStream` : ouverture, sélection de la caméra arrière, arrêt des pistes au démontage, reprise sur `visibilitychange`. Expose le `ref` vidéo, un état (`idle | starting | ready | denied | unavailable`) et `capture(): Promise<CapturedFrame>`.

Aucun autre module ne manipule de `MediaStream`.

### `src/align/`

Géométrie pure, sans DOM ni canvas. Le type `Transform`, `scaleMin(frame, shot, rotation)`, `clampToCover(transform, shot, frame)`, `toMatrix(transform, frame, shot)`, et un réducteur `gestureReducer(state, pointerEvent)` qui traduit les événements pointeur en `Transform` clampée.

C'est le cœur logique du calage et la partie la plus facile à casser silencieusement. Entièrement testable en Node.

### `src/render/`

Tout ce qui dessine. `drawShot(ctx, bitmap, transform, frame)` est la primitive partagée par l'aperçu et les exports — ce qu'on voit est donc ce qu'on exporte. Au-dessus : `renderSideBySide(before, after, opts): Promise<Blob>` et `renderCrossfadeGif(before, after, opts): Promise<Blob>`.

### `src/share/`

`shareOrDownload(file)` : utilise `navigator.share({ files })` quand `navigator.canShare` l'accepte, sinon déclenche un téléchargement via un lien objet-URL.

### `src/ui/`

Un composant par écran, qui orchestre les modules ci-dessus sans logique métier propre. Pas de store global : chaque écran lit ce dont il a besoin via de petits hooks au-dessus de `db/`.

## Exports

### Image côte-à-côte

Les deux rendus canoniques accolés : côte à côte si les photos sont en portrait, empilés si elles sont en paysage. Séparateur blanc de 8 px. Si l'option est active, la date sous chaque photo, format `JJ/MM/AAAA`, sur un bandeau de fond uni.

Chaque photo est réduite à 2048 px maximum sur son plus grand côté. Sortie JPEG qualité 0.85.

### GIF animé

Fondu en 10 étapes entre l'avant et l'après, pause de 500 ms à chaque extrémité, boucle infinie. Réduit à 640 px de large — au-delà, le fichier devient trop lourd pour un partage par messagerie.

Encodage avec `gifenc` dans un Web Worker, pour ne pas figer l'interface. Une barre de progression suit l'avancement, avec possibilité d'annuler.

Le GIF est retenu plutôt qu'un WebM parce qu'il se partage partout sans conversion, malgré sa palette de 256 couleurs. Si la qualité déçoit à l'usage, basculer sur `MediaRecorder` reste un changement local à `render/`.

## Gestion des erreurs

**Permission caméra refusée** — écran explicatif dédié, bouton « Réessayer », et rappel qu'un refus mémorisé se lève dans les réglages du navigateur. Le reste de l'app reste accessible : on peut toujours consulter, comparer et exporter les photos déjà prises.

**`getUserMedia` indisponible** (contexte non sécurisé, navigateur exotique) — message explicite, pas de plantage.

**Stockage** — `navigator.storage.persist()` est demandé au premier enregistrement, pour sortir du cache éphémère. L'écran de réglages affiche l'espace consommé et le quota via `navigator.storage.estimate()`, ainsi que l'état de la persistance. `QuotaExceededError` est traitée explicitement : message clair, la photo en cours n'est pas perdue (on reste sur l'écran de calage), suggestion de supprimer d'anciens clichés.

**Avertissement au premier lancement** — un message unique indique que les photos vivent sur cet appareil et disparaissent si les données du navigateur sont effacées. C'est le prix du 100 % local, et l'utilisateur doit le savoir avant d'accumuler six mois de chantier.

**Perte du flux caméra** (appel entrant, passage en arrière-plan) — `visibilitychange` déclenche une reprise de la capture au retour, plutôt que de laisser un rectangle noir.

**Échec d'écriture en base** — l'écran de calage est conservé avec la photo en mémoire, et un message propose de réessayer.

## Tests

**Unitaires (Vitest)**

- `align/` : `scaleMin` et `clampToCover` à rotation nulle et non nulle, bornes de translation, refus de sortir de ±15°, réducteur de gestes sur des séquences d'événements pointeur synthétiques.
- `db/` : sur `fake-indexeddb`, création, listage trié, agrégats de `listViewpoints`, suppression en cascade des photos d'un point de vue.
- `share/` : sélection de la branche partage ou téléchargement selon la disponibilité de `canShare`.

**Rendu (Playwright)**

Entrées synthétiques — deux aplats de couleur connus. Pour le côte-à-côte : dimensions de sortie attendues, et couleur de pixels échantillonnés dans chaque moitié. Pour le GIF : en-tête `GIF89a`, dimensions, nombre de frames après décodage.

Pas de comparaison d'images de référence : trop fragile d'une version de navigateur à l'autre.

**Parcours (Playwright)**

Chromium mobile émulé, lancé avec `--use-fake-device-for-media-stream` qui fournit une caméra synthétique. Parcours complet : créer un point de vue, capturer, nommer, reprendre une photo, caler, comparer, exporter le côte-à-côte.

Un smoke test charge l'app hors ligne pour vérifier que le service worker précache bien la coquille.

## Critères de réussite

1. Reprendre une photo d'un point de vue existant demande au plus trois interactions depuis l'écran d'accueil : ouvrir le point de vue, déclencher, valider.
2. L'export côte-à-côte est produit et proposé au partage en moins de 2 secondes sur un Android milieu de gamme.
3. L'export GIF est produit en moins de 8 secondes, sans figer l'interface.
4. Aucun export ne contient de zone vide : la contrainte de couverture le garantit par construction.
5. L'app se lance et permet de consulter, comparer et exporter en mode avion.
