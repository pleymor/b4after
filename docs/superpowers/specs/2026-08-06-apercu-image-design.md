# Aperçu en direct de l'image côte-à-côte

Date : 2026-08-06

## Problème

La feuille « Image côte-à-côte » propose trois réglages — dates, disposition, et
bientôt la taille du bandeau — mais rien ne montre leur effet. On règle à l'aveugle,
on exporte, on regarde le fichier, on revient corriger. Le bandeau de dates est le pire
cas : sa taille se juge à l'œil, pas dans une liste d'options.

## Principe

Afficher, en haut de la feuille, **le rendu réel** de l'export, recalculé à chaque
changement de réglage.

« Réel » au sens strict : l'aperçu appelle `renderSideBySide`, la fonction qui produit
le fichier exporté, avec une largeur maximale réduite. Le bandeau et la police étant
proportionnels à la largeur de cellule, un rendu à 480 px est exactement l'export à
2048 px, en plus petit. C'est le même invariant que celui tenu partout ailleurs :
l'aperçu et l'export passent par le même code, donc ils ne peuvent pas diverger.

Ajouter au passage un réglage de **taille du bandeau**, continu, puisque c'est
précisément ce qui se juge à l'œil.

## Modèle

`ImageOptions` gagne un champ :

```ts
export type ImageOptions = { stamp: StampMode; layout: Layout; stampScale: number }
```

- Défaut : `1`, qui reproduit exactement le rendu actuel.
- Bornes : `0.5` à `2`. La validation au chargement du `localStorage` ramène toute
  valeur hors bornes ou non numérique au défaut, comme pour les autres champs.

## Rendu

`renderSideBySide` gagne une option `maxEdge`, par défaut `EXPORT_MAX_EDGE` (2048) —
donc aucun appel existant ne change de comportement. L'aperçu passe `480`.

La hauteur du bandeau devient :

```ts
const bandHeight = showStamp ? Math.round(cellWidth * 0.14 * options.stampScale) : 0
```

La police continue de s'ajuster dans le bandeau par la logique existante, donc elle
suit l'échelle sans code supplémentaire.

## Interface

Dans la feuille « Image côte-à-côte », au-dessus des lignes de réglage :

- L'aperçu, `data-testid="image-preview"`, une image contenue dans une boîte dont la
  hauteur est plafonnée pour ne pas chasser les réglages hors de l'écran.
- Tant que les deux photos ne sont pas décodées, un texte d'attente plutôt qu'un vide.

Sous les lignes existantes, un curseur `data-testid="stamp-scale"`, de `0.5` à `2` par
pas de `0.1`, **désactivé quand `stamp` vaut `none`** : sans bandeau, il n'y a rien à
dimensionner.

Le recalcul de l'aperçu est **temporisé de 150 ms**. Un glissement continu émet des
dizaines d'événements, et chacun déclenche un encodage JPEG : sans temporisation on
réencoderait à chaque pixel parcouru.

## Non-objectifs

- Pas d'aperçu sur la feuille vidéo : un aperçu animé coûterait un encodage complet à
  chaque changement d'option.
- Pas de réglage de police indépendant de la hauteur du bandeau. La police s'ajuste
  déjà dans le bandeau ; deux réglages qui se contraignent l'un l'autre seraient plus
  déroutants qu'utiles.

## Tests

- Unitaire : la validation ramène un `stampScale` hors bornes, absent ou non numérique
  au défaut.
- Rendu : à `stampScale` doublé, la hauteur de l'image produite augmente exactement de
  la hauteur du bandeau supplémentaire — et l'export reste identique à `stampScale: 1`
  par rapport au comportement d'avant, pour prouver l'absence de régression.
- Parcours : l'aperçu apparaît dans la feuille, et déplacer le curseur change la
  **hauteur intrinsèque** de l'image d'aperçu. C'est l'assertion qui discrimine : un
  aperçu figé, ou un curseur non câblé, la laisserait constante.
