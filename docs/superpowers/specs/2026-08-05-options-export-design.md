# Options d'export de la comparaison

Date : 2026-08-05

## Problème

Sur l'écran Comparaison, l'image occupe presque toute la largeur — donc presque toute la
hauteur utile. Les deux boutons d'export sont sous elle, dans le flux, et sous eux la
barre de progression et la ligne de statut. Il faut donc scroller pour exporter, et
scroller encore pour lire le résultat, sur un écran où le seul geste naturel est le
glissement horizontal du curseur de révélation.

Deuxième manque : les réglages d'export sont figés dans le code. La disposition
côte-à-côte se déduit de l'orientation du cadre (`sideBySide.ts`), la vidéo joue
toujours trois fondus enchaînés à 640 px de large (`REPS`, `GIF_MAX_WIDTH`). Seul
l'affichage des dates est exposé, par une case à cocher.

## Principe

Sortir les commandes du flux et les réduire à deux icônes dans une barre fixe en bas de
l'écran. Chaque icône ouvre une feuille modale portant les réglages qui s'appliquent à
cet export, et le bouton qui le lance.

La barre étant hors du conteneur défilant, elle est fixe par construction. L'image, elle,
se contente de la hauteur restante : dans le cas courant l'écran ne défile plus du tout.

Les valeurs par défaut reproduisent exactement le comportement actuel. Qui ne touche à
rien ne voit aucun changement.

## Architecture

### `src/ui/components/Screen.tsx` (modifié)

Prop `footer?: ReactNode`, rendue en frère de `<main>` dans le conteneur
`flex h-full flex-col`. Hors du défileur, donc fixe sans `position: fixed` ni
`z-index` — le composant reste un simple empilement flex. Padding bas en
`env(safe-area-inset-bottom)` pour la barre d'accueil des iPhone.

### `src/ui/components/Sheet.tsx` (nouveau)

Feuille modale générique et sans logique métier : `{ title, open, onClose, children }`.

- Voile `bg-slate-950/70`, fermeture à la tape.
- Panneau ancré en bas, `rounded-t-2xl`, `max-h-[85%] overflow-y-auto` — une feuille plus
  haute que l'écran doit défiler en elle-même, pas déborder.
- `role="dialog"`, `aria-modal="true"`, `aria-label={title}`, en-tête titre + croix,
  Échap ferme.
- Transition CSS sur `translate-y`. Rend `null` fermée.

L'élément `<dialog>` natif est écarté : son voile et son top-layer sont attirants, mais le
repositionner en feuille basse et arbitrer son interaction avec le curseur de révélation
coûte plus que ce qu'il apporte ici.

### `src/ui/components/icons.tsx` (nouveau)

Deux icônes 24 px en SVG inline, `stroke="currentColor"` : image côte-à-côte, lecture
vidéo. Aucune dépendance ajoutée — une bibliothèque d'icônes pour deux glyphes alourdirait
le paquet d'une PWA dont l'installation hors-ligne est un objectif.

### `src/lib/exportOptions.ts` (nouveau)

```ts
export type StampMode = 'none' | 'date' | 'datetime'
export type Layout = 'auto' | 'horizontal' | 'vertical'
export type Transition = 'crossfade' | 'cut' | 'wipe'
export type VideoWidth = 640 | 1080 | 'full'
export type VideoLength = 1 | 3 | 5

export type ImageOptions = { stamp: StampMode; layout: Layout }
export type VideoOptions = { transition: Transition; width: VideoWidth; reps: VideoLength }
export type ExportOptions = { image: ImageOptions; video: VideoOptions }

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  image: { stamp: 'date', layout: 'auto' },
  video: { transition: 'crossfade', width: 640, reps: 3 },
}

export function parseExportOptions(raw: string | null): ExportOptions
export function loadExportOptions(): ExportOptions
export function saveExportOptions(options: ExportOptions): void
```

`parseExportOptions` valide **champ par champ** et retombe sur le défaut du champ fautif,
sans jeter : un `localStorage` périmé par une version future, tronqué, ou modifié à la
main ne doit pas pouvoir vider l'écran de comparaison. Un JSON illisible rend le défaut
complet.

Clé de stockage : `b4after.exportOptions`. Les écritures sont enveloppées d'un `try` —
en navigation privée, `setItem` peut lever, et perdre la mémorisation d'un réglage est
sans gravité au point de ne mériter aucun message.

### `src/hooks/useExportOptions.ts` (nouveau)

`const [options, update] = useExportOptions()`. Lecture au montage, écriture à chaque
changement.

`update` reçoit un patch partiel **fusionné champ par champ dans la section visée** :
`update({ image: { stamp: 'none' } })` conserve `layout` et laisse `video` intact. Une
feuille ne peut donc pas effacer un réglage qu'elle n'affiche pas.

### `src/lib/format.ts` (modifié)

`formatDateTime(timestamp)` → `01/08/2026 à 14:30`, fuseau local, même style que
`formatDate`.

### `src/render/crossfade.ts` (nouveau)

`gif.ts` et `video.ts` dupliquent aujourd'hui le même bloc « dessiner l'avant, puis
l'après en alpha ». Plutôt qu'une troisième copie pour les nouvelles transitions, le bloc
est extrait :

```ts
export function drawTransition(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  from: ScaledInput,
  to: ScaledInput,
  size: Size,
  mix: number,
  transition: Transition,
): void

/** Nombre de frames intermédiaires entre deux paliers. */
export function transitionSteps(transition: Transition): number
```

`ScaledInput` est le triplet `{ source, transform, shot }` que les deux fichiers
construisent déjà dans leur helper `scaled()` local — un `ComparisonInput` sans `takenAt`,
ramené à l'échelle d'export. Le type est déclaré dans `crossfade.ts` et importé par
`gif.ts` et `video.ts`, dont les helpers `scaled()` en deviennent les producteurs.

- `crossfade` — le mélange alpha actuel.
- `cut` — `mix < 0.5 ? from : to`, et `transitionSteps` rend `0`. Une coupe devient donc
  palier / palier, ce qui est exactement le rendu attendu ; aucune frame n'est gaspillée
  à figurer une transition qui n'existe pas.
- `wipe` — `from` en entier, puis `to` clippé à `[0, 0, width * mix, height]`. Le `mix`
  redescendant de 1 à 0 au retour, le balayage repart en sens inverse de lui-même.

`transitionSteps` rend `GIF_STEPS - 2` pour `crossfade` et `wipe` : le fondu conserve son
rythme actuel.

### `src/render/sideBySide.ts` (modifié)

`options: { showDates: boolean }` devient `options: ImageOptions`.

- `bandHeight` vaut 0 quand `stamp === 'none'`.
- Le texte vient de `formatDate` ou `formatDateTime` selon `stamp`.
- `horizontal = layout === 'auto' ? frame.height > frame.width : layout === 'horizontal'`.
  La règle automatique actuelle est donc préservée telle quelle sous `'auto'`.
- La chaîne datetime est environ 1,7× plus longue que la date seule, alors que la police
  du bandeau est calculée sur sa hauteur. Un garde-fou `measureText` réduit la taille
  jusqu'à ce que le texte tienne dans la cellule, sinon un cadre étroit verrait l'heure
  dépasser du bandeau.

### `src/render/video.ts` (modifié)

`renderCrossfadeVideo(before, after, frame, options)` accepte `transition`, `width` et
`reps` en plus de `onProgress` et `signal`. La constante `REPS` disparaît au profit de
`reps`. Les défauts égalent les constantes actuelles, donc les appels existants — ceux de
`e2e/render.spec.ts` notamment — restent valides sans modification.

`width` : `640` et `1080` sont des largeurs cibles ; `'full'` prend la largeur du cadre
plafonnée à `EXPORT_MAX_EDGE` (2048). Le `Math.min(1, …)` est conservé dans tous les cas :
un export n'agrandit jamais.

### `src/render/gif.ts` (modifié)

`renderCrossfadeGif` accepte `transition` et `width`.

**La durée reste propre à la vidéo.** Un GIF boucle à l'infini : des allers-retours
supplémentaires n'ajoutent rien à ce qu'on voit et multiplient le poids du fichier. La
ligne « Durée » est donc masquée quand `supportedVideoMime()` rend `null` — la feuille
n'affiche que ce qui s'appliquera réellement sur ce navigateur.

### `src/ui/CompareScreen.tsx` (modifié)

Corps :

- Le conteneur de l'image devient `flex min-h-0 flex-1`, le `RevealSlider` prend
  `h-full w-full`, et les deux `ShotCanvas` passent en `h-full w-full object-contain`.
  L'image tient donc dans la hauteur disponible au lieu de forcer un défilement.

  La boîte `aspect-ratio` disparaît. Une boîte `aspect-ratio` bornée à la fois en largeur
  et en hauteur se déforme dès que l'une des deux bornes mord — le ratio n'est préservé
  que si une seule dimension est définie. `object-contain` sur un canvas, élément
  remplacé de ratio intrinsèque connu, ne peut structurellement pas déformer.

  Le curseur de révélation reste juste : les deux canvas sont contenus à l'identique, la
  couture tombe donc au même `x` dans les deux. Seule la poignée blanche court dans les
  bandes noires du letterbox, ce que le `bg-black` déjà porté par le `RevealSlider` rend
  volontaire.
- La légende `date → date` reste dessous.
- La case à cocher des dates disparaît : elle vit maintenant dans la feuille image.

Pied de page (prop `footer` de `Screen`) :

```
├────────────────────────────┤
│ statut / progression       │
│     ⬓ Image     ▶ Vidéo    │
└────────────────────────────┘
```

Deux boutons icône + micro-libellé, `data-testid` `open-image-options` et
`open-video-options`, désactivés tant que `!ready` ou qu'un export est en cours. La zone
de statut est **dans** la barre : le retour d'export n'est plus jamais hors écran, ce qui
est l'autre moitié du problème.

Deux feuilles :

- **Image** — `stamp` (Aucun / Date / Date + heure, `data-testid="stamp-mode"`), `layout`
  (Auto / Horizontal / Vertical), puis « Exporter l'image » (`export-jpeg`).
- **Vidéo** — `transition` (Fondu / Coupe franche / Balayage), `width`
  (Standard 640 px / Haute 1080 px / Maximale), `reps` (Court / Moyen / Long), puis
  « Exporter la vidéo » (`export-gif`).

La barre de progression et le bouton d'annulation vivent **dans** la feuille, où ils
gardent leurs `data-testid` (`export-progress`, `cancel-export`) : le bouton qui a lancé
l'export est là, celui qui l'annule doit y être aussi. La feuille se ferme **dans tous les
cas** une fois l'export terminé — succès, échec ou annulation — et le
statut s'affiche dans la barre. Le verrou `busy` est inchangé.

## Flux de données

```
montage → useExportOptions() lit localStorage (ou les défauts)
tape sur ⬓ → feuille image ouverte
changement d'un réglage → update() → état + localStorage
tape sur « Exporter l'image »
  → renderSideBySide(before, after, frame, options.image)
  → shareOrDownload
  → feuille fermée, statut dans la barre
```

Le chemin vidéo est le même, `supportedVideoMime()` arbitrant entre
`renderCrossfadeVideo(…, options.video)` et son repli
`renderCrossfadeGif(…, { transition, width })`.

## Erreurs

- **`localStorage` illisible ou corrompu** : défauts silencieux, aucun message. Voir
  `parseExportOptions`.
- **`localStorage` en écriture impossible** (navigation privée) : le réglage s'applique à
  l'export en cours mais n'est pas mémorisé. Silencieux.
- **Échec de rendu ou de partage** : la feuille se ferme et le message s'affiche dans la
  zone de statut de la barre, en couleur d'alerte. La fermeture est indispensable : le
  panneau de la feuille est ancré au bas du viewport et recouvrirait entièrement cette
  zone, donc un message rendu feuille ouverte serait invisible — et inaccessible aux
  lecteurs d'écran, `aria-modal` aidant.
- **Annulation** : la feuille se ferme aussi, et « Export annulé. » s'affiche dans la même
  zone, en couleur neutre — l'utilisateur a obtenu ce qu'il demandait, ce n'est pas une
  erreur.
- **Fermeture pendant un encodage** : refusée tant qu'un export animé tourne. La
  progression et le bouton d'annulation vivant dans la feuille, la laisser se fermer
  priverait l'utilisateur des deux d'un coup, sans moyen de revenir — les icônes de la
  barre étant elles-mêmes désactivées pendant ce temps. Le refus est porté par l'appelant,
  pas par `Sheet`, qui reste ignorant de la notion d'export.

## Tests

Unitaires (`vitest`) :

- `exportOptions` — JSON illisible rend le défaut complet ; valeur d'énumération inconnue
  retombe sur le défaut de ce champ seul ; objet partiel complété champ par champ ;
  aller-retour `save` / `load` fidèle ; `save` qui lève ne propage pas.
- `format` — `formatDateTime` sur un timestamp connu, à côté des cas existants de
  `formatDate`.

End-to-end (`playwright`) :

- `flow.spec.ts` — les quatre clics d'export existants gagnent une tape d'ouverture de
  feuille. Un test vérifie qu'un réglage modifié est retrouvé après rechargement de la
  page. Un autre garde le motif du problème d'origine : sur un écran de téléphone, les
  deux boutons de la barre sont visibles **sans défiler**, et le conteneur défilant n'a
  rien à défiler (`scrollHeight <= clientHeight + 1`).
- `render.spec.ts` — les trois appels `renderSideBySide({ showDates })` passent à
  `{ stamp, layout }`. Nouveaux cas : `layout: 'vertical'` empile un cadre **portrait**
  (inverser la règle automatique est ce qui prouve que l'option est honorée) ;
  `stamp: 'datetime'` réserve son bandeau ; `transition: 'cut'` et `'wipe'` produisent un
  fichier non trivial ; `width: 1080` élargit au-delà des 640 px par défaut sans jamais
  agrandir un cadre plus petit.

## Risque connu

En qualité maximale, `MediaRecorder` encode jusqu'à 2048 px de large. La capture étant en
temps réel, la durée d'encodage ne change pas, mais le fichier peut devenir lourd à
partager. C'est le sens assumé du réglage, et le défaut reste 640 px.

Cet argument ne se transporte pas au repli GIF : `renderCrossfadeGif` accumule en mémoire
les frames RGBA brutes de chaque palier avant de les poster au worker de quantification,
et ce coût-là *dépend* de la largeur — environ 83 Mo à 1920×1080 contre 10 Mo à 640 px pour
un cadre 16:9, et la quantification tourne sur autant de pixels par frame. Le repli ne
s'emprunte en outre que sur les navigateurs sans `MediaRecorder` MP4, donc précisément les
appareils les plus faibles. Le chemin GIF plafonne donc sa largeur à 1080 px
(`GIF_WIDTH_CAP` dans `gif.ts`) même quand `'full'` est demandé : un GIF moins large que la
qualité maximale promise est un moindre mal face à un onglet qui meurt sur un téléphone
d'entrée de gamme. La vidéo, chemin normal, continue d'honorer la pleine résolution.

## Hors périmètre

- Exposer ces réglages dans l'écran Réglages. Ils se décident au moment d'exporter, sous
  les yeux de l'image concernée.
- Un aperçu direct de la transition choisie dans la feuille. Le curseur de révélation
  donne déjà le sens du avant/après, et animer un aperçu pendant qu'on règle coûterait un
  second chemin de rendu à maintenir.
- Toucher au curseur de révélation, au calage ou à la prise de vue.
