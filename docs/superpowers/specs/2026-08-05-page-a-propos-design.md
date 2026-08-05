# Page À propos

Date : 2026-08-05

## Problème

Rien dans l'application ne dit ce qu'elle est, qui l'a écrite, ni quelle version tourne.
L'écran Réglages affiche une ligne `Version 0.0.0` — exacte au sens de `package.json`,
mais sans valeur : elle ne distingue pas la version déployée sur le VPS de celle d'il y a
trois semaines. Et rien ne permet de faire connaître l'application à quelqu'un d'autre,
alors que c'est une PWA dont le partage d'un lien est le seul canal d'installation.

## Principe

Une page dédiée, atteinte depuis les Réglages, qui répond à quatre questions : ce que fait
cette application, qui l'a faite, quelle version tourne exactement, et comment la faire
connaître.

L'identité de version devient vérifiable plutôt que déclarative : à côté du numéro de
`package.json`, la date de build et la révision git sont injectées au moment du build. On
peut donc regarder la page d'un appareil et savoir précisément ce qu'il exécute.

## Architecture

### `package.json` (modifié)

`version` passe de `0.0.0` à `1.0.0`. L'application est déployée et fonctionnelle ;
l'incrémentation ultérieure reste manuelle, rien ne l'automatise.

### `vite.config.ts` (modifié)

Deux constantes rejoignent `__APP_VERSION__` dans `define` :

```ts
__BUILD_DATE__: JSON.stringify(new Date().toISOString()),
__COMMIT_SHA__: JSON.stringify(shortSha()),
```

`shortSha()` est une fonction locale de `vite.config.ts` : elle exécute
`git rev-parse --short HEAD` via `execSync` (`node:child_process`) sous `try` / `catch`,
`stdio` en `pipe` pour ne pas polluer la sortie du build, et rend `'dev'` en cas d'échec — un build depuis une archive sans dépôt git doit réussir, pas planter. Le
`actions/checkout@v4` de la CI donne accès à `HEAD` même en clone superficiel, la valeur
est donc réelle en production.

### `src/vite-env.d.ts` (modifié)

`declare const __BUILD_DATE__: string` et `declare const __COMMIT_SHA__: string`, à côté
de la déclaration existante de `__APP_VERSION__`.

### `src/share/shareLink.ts` (nouveau)

`shareOrDownload` ne sait partager qu'un `File` : `navigator.share({ files })` et
`navigator.share({ url })` sont deux formes d'appel différentes, et le repli n'est pas le
même — un lien se copie, il ne se télécharge pas. D'où un module distinct, qui reprend les
conventions du premier.

```ts
export async function shareLink(
  url: string,
  title: string,
): Promise<'shared' | 'copied' | 'cancelled' | 'failed'>
```

- `navigator.share({ title, url })` quand il existe. `AbortError` rend `'cancelled'` :
  l'utilisateur qui referme la feuille de partage n'a pas subi une erreur, et on ne lui
  copie rien dans le presse-papier derrière son dos.
- Sinon, ou après un échec réel du partage, `navigator.clipboard.writeText(url)` →
  `'copied'`.
- Ni l'un ni l'autre, ou le presse-papier refuse → `'failed'`.

### `src/ui/AboutScreen.tsx` (nouveau)

Sur le `Screen` existant, titre « À propos », retour vers `/settings`. Quatre sections,
même grammaire visuelle que `SettingsScreen` (`space-y-6 p-4 text-sm`, titres de section
en `font-semibold text-slate-200`).

1. **Le projet** — deux paragraphes, texte arrêté :

   > b4after sert à reprendre une photo sous le même angle qu'une photo précédente, puis à
   > en générer des comparaisons avant/après. Elle a été pensée pour documenter un
   > chantier : la photo de référence se superpose au flux caméra pour retrouver le
   > cadrage, et un écran de calage permet d'ajuster au doigt.
   >
   > Tout reste sur cet appareil. Aucun compte, aucun serveur, aucun appel réseau une fois
   > l'application installée.
2. **L'auteur** — « Pleymor », et un lien vers `https://github.com/pleymor/b4after` en
   `target="_blank" rel="noreferrer"`. Pas d'adresse e-mail : elle est dans l'historique
   git pour qui la cherche, l'afficher sur une page publique l'offrirait aux moissonneurs.
3. **Version** — trois lignes : `Version 1.0.0`, `Mise en ligne le 05/08/2026`,
   `Révision a1b2c3d`. La date passe par `formatDate(Date.parse(__BUILD_DATE__))`, donc
   aucun nouveau formateur. `data-testid` : `app-version`, `build-date`, `commit-sha`.
4. **Partager** — bouton « Partager l'application » (`data-testid="share-app"`) appelant
   `shareLink(window.location.origin, 'b4after')`. Le retour alimente une ligne de statut
   (`share-status`) : rien à dire pour `'shared'` et `'cancelled'`, « Lien copié. » pour
   `'copied'`, « Le partage a échoué. » pour `'failed'`.

`window.location.origin` plutôt qu'un domaine codé en dur : le lien partagé est celui par
lequel on a ouvert l'application, donc toujours joignable, et il n'y a pas de constante à
corriger le jour d'un déménagement.

### `src/ui/SettingsScreen.tsx` (modifié)

La ligne `Version {__APP_VERSION__}` **déménage** vers la page À propos — elle n'est pas
dupliquée, sinon la même information vivrait à deux endroits et finirait par diverger. À
sa place, un lien « À propos » vers `/about`, avec le `data-testid="about-link"`.

Le `data-testid="app-version"` suit la ligne sur la page À propos, où le test e2e existant
des Réglages allait le chercher : ce test navigue donc d'un cran de plus.

### `src/App.tsx` (modifié)

Route `/about` → `<AboutScreen />`.

## Flux de données

```
Réglages → tape sur « À propos » → /about
  affichage : __APP_VERSION__, __BUILD_DATE__, __COMMIT_SHA__   [figés au build]
  tape sur « Partager l'application »
    → shareLink(window.location.origin, 'b4after')
    → 'shared' | 'cancelled' : rien à dire
    → 'copied'   : « Lien copié. »
    → 'failed'   : « Le partage a échoué. »
```

## Erreurs

- **Build sans dépôt git** : `__COMMIT_SHA__` vaut `'dev'`, la page l'affiche tel quel.
- **`Date.parse(__BUILD_DATE__)` invalide** (constante absente d'un build bricolé) : la
  ligne de date n'est pas rendue plutôt que d'afficher `NaN/NaN/NaN`.
- **Partage refusé ou presse-papier indisponible** : message dans la ligne de statut, rien
  d'autre ne casse.

## Tests

Unitaires (`vitest`) :

- `shareLink` — partage natif utilisé quand il existe ; `AbortError` rend `'cancelled'`
  **sans** toucher au presse-papier ; absence de `navigator.share` bascule sur la copie ;
  échec réel du partage bascule aussi sur la copie ; `writeText` qui lève rend
  `'failed'`. Sur le modèle de stubbing de `shareOrDownload.test.ts`.

End-to-end (`playwright`) :

- Depuis les Réglages, le lien « À propos » mène à la page, qui affiche un numéro de
  version, une date au format `JJ/MM/AAAA` et une révision non vide.
- Le test existant `affiche l'état du stockage dans les réglages` perd son assertion sur
  `app-version` — elle rejoint le nouveau test, où elle a désormais lieu d'être.

## Risque connu

`__BUILD_DATE__` change à chaque build : l'empreinte du bundle change donc même sans
modification de code, et `registerType: 'autoUpdate'` fera retélécharger l'application aux
clients à chaque déploiement. Le dépôt déploie déjà à chaque push sur `main`, l'effet est
donc essentiellement le même qu'aujourd'hui — et c'est le prix d'une date de mise en ligne
honnête.

## Hors périmètre

- Licence, mentions légales, remerciements de dépendances, lien de don.
- Un CHANGELOG ou des balises git. La date de build et la révision répondent à la question
  « qu'est-ce qui tourne ici », qui est celle qui se pose.
- Traduire la page. L'application est en français d'un bout à l'autre.
