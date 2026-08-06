# Fluidité et rythme de l'export vidéo

Date : 2026-08-06

## Problème

Les transitions vidéo paraissent saccadées et précipitées.

Cause mesurée : pendant un fondu, la vidéo ne dessine que **8 images distinctes**,
maintenues 80 ms chacune. `captureStream(30)` capture bien 30 images par seconde, mais
ce sont des doublons — l'animation réelle tourne à **12,5 images/s**. Et le fondu ne
dure que `8 × 80 = 640 ms`.

L'origine est historique : `transitionSteps()` rend `GIF_STEPS - 2`, et la vidéo
consomme cette valeur comme le GIF. Or ce budget d'images est une contrainte propre au
GIF — palette, aucune compression inter-images, chaque image coûte des octets. Le H.264
n'a aucune de ces contraintes et encode même un mouvement fluide **moins cher** qu'un
mouvement saccadé.

## Principe

Découpler la vidéo du modèle en paliers du GIF.

La vidéo anime **contre le temps écoulé** : à chaque `requestAnimationFrame`, elle
calcule la progression depuis le début de la phase et appelle `drawTransition` avec ce
`mix` continu. `drawTransition` accepte déjà un `mix` fractionnaire — la discrétisation
ne venait que de l'appelant.

Le GIF, lui, ne change pas : ses paliers restent la bonne réponse à son format.

## Rythme

Nouveau réglage `pace` dans les options vidéo, quatrième ligne de la feuille :

| Valeur | Libellé | Fondu |
| --- | --- | --- |
| `slow` | Lent | 1800 ms |
| `normal` | Normal | 1200 ms |
| `fast` | Rapide | 700 ms |

Défaut : `normal`. Le palier passe de 500 ms à **700 ms** pour tous les rythmes : on
voit mieux chaque photo avant que ça ne reparte, ce qui est le but d'une comparaison.

Ces durées appartiennent à la vidéo. `GIF_HOLD_MS` et `GIF_STEP_MS` cessent d'être
importés par `video.ts`.

## Conséquence sur la durée totale

Un aller-retour vaut `palier + fondu`. À `normal`, 1900 ms contre 1140 ms aujourd'hui.
Une vidéo « Moyen » (3 allers-retours) passe donc de 3,4 s à 5,7 s, et une « Long »
au rythme « Lent » atteint 12,5 s. C'est assumé : le réglage existe pour que
l'utilisateur arbitre lui-même entre fluidité et poids.

## Progression et annulation

La barre de progression devient **temporelle** : rapport du temps écoulé à la durée
totale prévue, et non plus un compte de paliers franchis. L'annulation reste inchangée.

## Limite connue

Une animation pilotée par `requestAnimationFrame` est ralentie ou suspendue si l'onglet
passe en arrière-plan. `MediaRecorder` enregistrant en temps réel, l'export était déjà
dégradé dans ce cas — ce n'est donc pas une régression, mais ça reste vrai.

## Non-objectifs

- Pas de changement du GIF.
- Pas de passage à 60 images/s : 30 suffit pour un fondu, et doubler les images
  alourdirait le fichier sans gain perceptible.

## Tests

- Unitaire : le rythme absent, inconnu ou mal typé retombe sur `normal`, comme les
  autres options.
- Rendu : à rythme égal, une vidéo produite contient **nettement plus d'images
  distinctes** qu'avec l'ancien modèle en paliers. L'assertion qui discrimine consiste
  à échantillonner la vidéo produite à des instants rapprochés au milieu d'un fondu et
  à vérifier que les images diffèrent — avec 8 paliers de 80 ms, deux instants séparés
  de 40 ms tombent souvent sur le même palier et donnent des images identiques.
- Rendu : la durée totale d'une vidéo suit le rythme choisi, `slow` produisant une
  durée strictement supérieure à `fast` pour le même nombre d'allers-retours.
