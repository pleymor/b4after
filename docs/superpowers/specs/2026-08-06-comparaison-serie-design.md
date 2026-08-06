# Comparaison de toute la série

Date : 2026-08-06

## Problème

Un point de vue accumule autant de photos qu'on veut, mais la comparaison en retient
exactement deux, choisies par des boutons radio « avant » et « après » sur l'écran de
détail. Sur une série de six photos de chantier, c'est en jeter quatre.

## Principe

La comparaison porte sur **toute la série**, dans l'ordre chronologique. Plus de
sélection : plus de boutons radio, et l'URL `/v/:id/compare` ne porte plus de
paramètres.

## Écran de détail

Les deux colonnes de boutons radio disparaissent de chaque ligne. « Comparer » reste
désactivé tant qu'il y a moins de deux photos.

## Écran de comparaison

La poignée de révélation, qui compare deux images par construction, est remplacée par
un **curseur temporel** : une réglette continue de `0` à `N-1` sous l'image. À la
valeur `v`, on affiche un fondu entre la photo `floor(v)` et la suivante, d'opacité
`v - floor(v)`. Aux valeurs entières, une seule photo est visible.

Même geste qu'avant, même rôle — vérifier le calage avant d'exporter — mais sur toute
la série.

## Exports

Les deux exports prennent désormais une **liste** de photos au lieu d'un couple.

**Image côte-à-côte** : les `N` photos accolées dans l'ordre, `N-1` séparateurs de
8 px. La disposition suit la règle actuelle — cadre portrait, bande horizontale ; cadre
paysage ou carré, empilement vertical. Le plafond de 2048 px reste **par photo**,
conformément au spec d'origine : une bande de cinq photos portrait fait donc près de
8000 px de large. C'est le choix assumé de privilégier le détail.

**Vidéo** : palier sur la photo 1, transition, palier sur la photo 2, … jusqu'à la
dernière. Durée totale `N × palier + (N-1) × fondu`. Les réglages existants — rythme,
durée d'affichage, transition, largeur — s'appliquent inchangés.

## Mémoire : le vrai risque de ce changement

Jusqu'ici l'app ne décodait jamais plus de deux photos à la fois. Une série de dix
photos de 12 mégapixels représente environ 480 Mo de bitmaps décodés — de quoi faire
tuer l'onglet par le système sur un téléphone.

Deux règles en découlent, et elles ne sont pas négociables :

- **L'aperçu décode en réduit.** `createImageBitmap` accepte `resizeWidth` : l'aperçu
  ne décode jamais au-delà de la taille d'affichage. C'est aussi ce qui rend le curseur
  fluide.
- **Les exports décodent une photo à la fois.** Le rendu décode, dessine, puis libère
  (`bitmap.close()`) avant de passer à la suivante. Aucun moment où plus d'une ou deux
  photos pleine résolution coexistent.

Cette seconde règle change la signature des fonctions de rendu : elles reçoivent les
photos et leurs transformations, et se chargent elles-mêmes du décodage, au lieu de
recevoir des bitmaps déjà décodés.

## Non-objectifs

- Pas de sélection d'un sous-ensemble. La demande est de tout prendre ; ajouter un
  filtre irait contre.
- Pas de changement du GIF au-delà du parcours de la série.
- Pas de grille ni de plafond global sur l'image côte-à-côte : le choix retenu est la
  bande complète à pleine résolution.

## Tests

- Rendu : une série de trois photos produit une image de trois cellules et deux
  séparateurs, aux dimensions calculées à la main — pas dérivées de la formule testée.
- Rendu : la vidéo d'une série de trois photos dure `3 × palier + 2 × fondu` et **se
  termine sur la dernière photo**, assertion déjà en place pour deux photos.
- Rendu : le pic de mémoire ne croît pas avec la longueur de la série. À mesurer par le
  nombre de bitmaps vivants simultanément, en instrumentant `createImageBitmap` et
  `close`, plutôt que par une mesure de mémoire — plus stable et plus lisible. C'est
  l'assertion qui discrimine un décodage séquentiel d'un décodage global.
- Parcours : le curseur parcourt la série, et l'écran de détail ne porte plus de boutons
  radio.
