# Passage unique et durée d'affichage des photos

Date : 2026-08-06

## Problème

La vidéo joue plusieurs allers-retours entre l'avant et l'après — trois par défaut,
réglables par la ligne « Longueur » (Court, Moyen, Long, soit 1, 3 ou 5 fondus
alternés). À l'usage, un seul passage de l'ancien vers le nouveau suffit : c'est le
propos d'une comparaison avant/après, et la boucle n'ajoute que de la longueur.

Ce qui manque en revanche, c'est le contrôle du temps pendant lequel **chaque photo
reste affichée**. Il est aujourd'hui figé à 700 ms. Avec un passage unique, c'est ce
réglage-là qui décide si l'on a le temps de voir l'avant et l'après.

## Principe

La vidéo joue **un seul passage** : palier sur l'avant, transition, palier sur l'après.
Fin. Quelle que soit la transition choisie.

La ligne « Longueur » disparaît, remplacée par « Durée des photos », qui règle la durée
des deux paliers.

## Modèle

Dans `VideoOptions` :

- `reps: VideoLength` est **retiré**. Une valeur `reps` restée dans le `localStorage`
  d'un utilisateur existant est simplement ignorée : la validation reconstruit l'objet
  à partir des champs connus.
- `hold: HoldDuration` est **ajouté**, avec `'short' | 'medium' | 'long'`.

| Valeur | Libellé | Durée |
| --- | --- | --- |
| `short` | Courte | 700 ms |
| `medium` | Moyenne | 1200 ms |
| `long` | Longue | 2000 ms |

Défaut : `medium`.

`pace` ne change pas : il règle la transition, `hold` règle les paliers. Les deux sont
utiles et ne se recouvrent pas.

## Durées obtenues

Un passage vaut `hold + fondu + hold`.

| Réglages | Total |
| --- | --- |
| Durée moyenne, rythme normal | 1200 + 1200 + 1200 = **3,6 s** |
| Durée courte, rythme rapide | 700 + 700 + 700 = **2,1 s** |
| Durée longue, rythme lent | 2000 + 1800 + 2000 = **5,8 s** |
| Transition Coupe, durée moyenne | 1200 + 0 + 1200 = **2,4 s** |

Toutes restent sous les six secondes, ce qui convient à un partage par messagerie.

## Point d'attention

La vidéo doit **se terminer sur le palier de l'après**, pas à la fin de la transition.
C'est le seul état que le spectateur doit retenir, et une vidéo qui s'arrête net sur la
dernière image du fondu donne l'impression d'être coupée. Le code actuel a déjà dû
traiter explicitement le dessin de l'état final ; ce point reste vrai et devient plus
visible avec un passage unique.

## Non-objectifs

- Pas de changement du GIF, qui garde ses allers-retours et son modèle en paliers.
- Pas de réglage indépendant pour le palier de l'avant et celui de l'après : deux
  durées à accorder pour un gain douteux.

## Tests

- Unitaire : `hold` absent, inconnu ou mal typé retombe sur `medium` ; un `reps`
  résiduel dans le stockage est ignoré sans faire échouer la validation.
- Rendu : la vidéo produite dure `2 × hold + fondu`, à la tolérance d'encodage près, et
  une durée longue produit une vidéo strictement plus longue qu'une durée courte à
  rythme égal.
- Rendu : la **dernière image** de la vidéo montre l'après, et non un état intermédiaire
  de la transition. C'est l'assertion qui discrimine une vidéo terminée trop tôt.
