# b4after

PWA smartphone pour reprendre une photo sous le même angle qu'une photo précédente, puis
générer des comparaisons avant/après. Pensée pour documenter un chantier.

## Principe

Un **point de vue** est un endroit d'où l'on reprend la même photo au fil du temps. Sa
première photo définit un **cadre canonique** ; chaque photo suivante porte une
transformation qui place ses pixels dans ce cadre. Les blobs d'origine ne sont jamais
recadrés : le calage reste réversible. Le point de vue et sa photo de référence sont créés
en une seule transaction (`createViewpointWithFirstShot`), pour qu'un échec d'écriture ne
laisse jamais un point de vue orphelin sans photo.

À la reprise, la dernière photo de la série est superposée en semi-transparent sur le flux
caméra. Après la prise, un écran de calage permet d'ajuster au doigt (déplacer, pincer,
pivoter jusqu'à ±15°), sous une contrainte de couverture qui garantit qu'aucun export ne
contiendra de zone vide.

## Données

Tout vit dans IndexedDB, sur l'appareil. Aucun compte, aucun serveur, aucun appel réseau à
l'exécution. Effacer les données du navigateur efface les photos — l'app le dit au premier
lancement et demande `storage.persist()` au premier enregistrement, qu'il s'agisse de la
photo de référence d'un point de vue ou d'une reprise. L'écran de réglages permet de
redemander la persistance à tout moment si le navigateur l'a refusée.

## Développement

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # tests unitaires (Vitest)
npm run test:e2e   # tests de rendu, de parcours et hors ligne (Playwright)
npm run build
```

Les tests Playwright du projet `dev` importent les modules TS servis par Vite depuis
`page.evaluate`, et utilisent la caméra synthétique de Chromium
(`--use-fake-device-for-media-stream`). Le projet `prod` tourne sur un vrai build, seul
contexte où le service worker existe.

## Structure

| Dossier | Rôle |
| --- | --- |
| `src/align/` | Géométrie du calage et réducteur de gestes — pur, sans DOM ; `surface.ts` convertit les coordonnées du pointeur en pixels du cadre canonique, avec un ratio par axe |
| `src/db/` | Seule couche qui touche IndexedDB, plus la persistance et le quota |
| `src/camera/` | Seul module qui manipule un `MediaStream` |
| `src/render/` | Seul module qui touche un canvas : dessin, vignettes, exports JPEG et GIF ; `toJpegBlob.ts` est partagé par les vignettes et la capture caméra |
| `src/share/` | Partage natif avec repli téléchargement |
| `src/ui/` | Un composant par écran, sans logique métier ; l'écran de capture (`CameraScreen.tsx`) est un simple routeur entre `FirstCaptureScreen` (photo de référence, seule à écrire en base) et `RetakeCaptureScreen` (calque fantôme, n'écrit jamais) — une reprise ne peut donc jamais retomber dans la création d'un point de vue |

Spécification : `docs/superpowers/specs/2026-08-01-b4after-design.md`
