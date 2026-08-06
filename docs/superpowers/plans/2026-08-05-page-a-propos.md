# Page À propos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter une page `/about`, atteinte depuis les Réglages, qui présente le projet et son auteur, affiche une identité de version vérifiable (numéro, date de build, révision git) et permet de partager le lien de l'application.

**Architecture :** Trois constantes figées au build (`__APP_VERSION__`, `__BUILD_DATE__`, `__COMMIT_SHA__`) injectées par `vite.config.ts`, un module de partage de lien distinct de celui des fichiers, et un écran de lecture seule sans logique métier. La ligne de version **déménage** des Réglages plutôt que d'y être dupliquée.

**Tech Stack :** Vite, React 19, TypeScript, Tailwind 4, `react-router`, Vitest (environnement node), Playwright.

**Spec :** `docs/superpowers/specs/2026-08-05-page-a-propos-design.md`

## Global Constraints

- Interface **en français uniquement**.
- **Aucun appel réseau à l'exécution.** Le lien vers GitHub est un `<a>` que l'utilisateur choisit de suivre, pas une requête.
- **Aucune adresse e-mail affichée.** Elle est dans l'historique git pour qui la cherche ; sur une page publique elle nourrirait les moissonneurs.
- L'URL partagée vient de **`window.location.origin`**, jamais d'un domaine codé en dur.
- Un build **sans dépôt git doit réussir** : `__COMMIT_SHA__` vaut alors `'dev'`.
- `process.env.npm_package_version` n'est peuplé que par les scripts npm. Le serveur de dev et le build passent tous les deux par `npm run …` (voir `playwright.config.ts`), la valeur est donc réelle en test comme en production.
- Environnement de test unitaire = **node** : ni `window`, ni `navigator`, ni `document`. Les stubber avec `vi.stubGlobal`, sur le modèle de `src/share/shareOrDownload.test.ts`.
- Messages de commit en français, préfixe conventionnel (`feat:`, `chore:`).
- Dans le code livré, tout texte visible porte une vraie apostrophe droite (`'`), en échappant la chaîne si nécessaire (`"L'application…"`).

## File Structure

| Fichier | Responsabilité |
| --- | --- |
| `package.json` | **Modifié.** `version` passe à `1.0.0`. |
| `vite.config.ts` | **Modifié.** Injecte `__BUILD_DATE__` et `__COMMIT_SHA__`. |
| `src/vite-env.d.ts` | **Modifié.** Déclare les deux nouvelles constantes. |
| `src/share/shareLink.ts` | **Nouveau.** Partage d'une URL, repli sur le presse-papier. Distinct de `shareOrDownload` : autre forme d'appel, autre repli. |
| `src/share/shareLink.test.ts` | **Nouveau.** Unitaire. |
| `src/ui/AboutScreen.tsx` | **Nouveau.** Écran de lecture seule + bouton de partage. |
| `src/ui/SettingsScreen.tsx` | **Modifié.** La ligne de version part, un lien « À propos » arrive. |
| `src/App.tsx` | **Modifié.** Route `/about`. |
| `e2e/flow.spec.ts` | **Modifié.** L'assertion sur `app-version` déménage vers un nouveau test. |

---

### Task 1: Identité de version figée au build

**Files:**
- Modify: `package.json:4`
- Modify: `vite.config.ts`
- Modify: `src/vite-env.d.ts`

**Interfaces:**
- Consumes: rien.
- Produces: les constantes globales `__BUILD_DATE__: string` (ISO 8601) et `__COMMIT_SHA__: string`, disponibles dans tout le code source aux côtés de `__APP_VERSION__`. Consommées par la Task 3.

- [ ] **Step 1: Passer la version à 1.0.0**

Dans `package.json`, remplacer `"version": "0.0.0",` par `"version": "1.0.0",`.

- [ ] **Step 2: Injecter les deux constantes**

Dans `vite.config.ts`, ajouter l'import et la fonction locale en tête de fichier, après les imports existants :

```ts
import { execSync } from 'node:child_process'

/**
 * Révision git courte, ou `'dev'` quand le build ne part pas d un dépôt — une archive
 * téléchargée doit pouvoir se construire. `stdio` en `pipe` pour que l échec de la
 * commande ne salisse pas la sortie du build.
 */
function shortSha(): string {
  try {
    return execSync('git rev-parse --short HEAD', {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim()
  } catch {
    return 'dev'
  }
}
```

Puis remplacer le bloc `define` :

```ts
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    // Évaluée au chargement de la config, donc à chaque build. C est ce qui rend la
    // date honnête — et, accessoirement, ce qui fait changer l empreinte du bundle à
    // chaque déploiement, donc retélécharger les clients. Le dépôt déployant déjà à
    // chaque push, l effet est le même qu avant.
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
    __COMMIT_SHA__: JSON.stringify(shortSha()),
  },
```

- [ ] **Step 3: Déclarer les constantes pour TypeScript**

Dans `src/vite-env.d.ts`, ajouter sous la déclaration existante :

```ts
/** Date du build, au format ISO 8601. Figée par `vite.config.ts`. */
declare const __BUILD_DATE__: string
/** Révision git courte du build, ou `'dev'` hors dépôt. */
declare const __COMMIT_SHA__: string
```

- [ ] **Step 4: Vérifier que les valeurs arrivent réellement dans le bundle**

Run: `npm run build`
Expected: succès. **Ne cherche pas encore la révision dans le bundle** : Vite ne
substitue une constante `define` que là où l'identifiant est *référencé* dans les
sources, et rien ne référence `__COMMIT_SHA__` avant la Task 3. La vérification que la
valeur atterrit réellement dans le bundle compilé a donc lieu en Task 3, une fois la
page qui l'affiche écrite.

Puis vérifier le chemin de repli. `execSync` lève quand `git rev-parse` sort en erreur,
et c'est ce que fait la commande hors d'un dépôt :

Run: `cd "$(mktemp -d)" && git rev-parse --short HEAD; echo "code de sortie : $?"`
Expected: un code de sortie **non nul** (`128`, « not a git repository »). C'est
exactement la condition qui déclenche le `catch` de `shortSha`, donc le repli sur
`'dev'`. Reconstruire tout le projet dans un répertoire sans `.git` coûterait une copie
de `node_modules` pour vérifier la même chose.

⚠️ Ne pas oublier de revenir dans le dépôt (`cd -`) avant l'étape suivante.

- [ ] **Step 5: Commit**

```bash
git add package.json vite.config.ts src/vite-env.d.ts
git commit -m "chore: version 1.0.0 et identité de build injectée par Vite"
```

---

### Task 2: Partage d'un lien

**Files:**
- Create: `src/share/shareLink.ts`
- Test: `src/share/shareLink.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `shareLink(url: string, title: string): Promise<'shared' | 'copied' | 'cancelled' | 'failed'>`. Consommée par la Task 3.

- [ ] **Step 1: Write the failing test**

Créer `src/share/shareLink.test.ts` :

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { shareLink } from './shareLink'

const URL_TO_SHARE = 'https://exemple.test'

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Faux `navigator` : `share` et `clipboard` sont posés à la demande. */
function stubNavigator(value: unknown) {
  vi.stubGlobal('navigator', value)
}

describe('shareLink', () => {
  it('passe par le partage natif quand il existe', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn()
    stubNavigator({ share, clipboard: { writeText } })

    expect(await shareLink(URL_TO_SHARE, 'b4after')).toBe('shared')
    expect(share).toHaveBeenCalledWith({ title: 'b4after', url: URL_TO_SHARE })
    // Un partage réussi ne doit pas copier en plus : l utilisateur a déjà agi.
    expect(writeText).not.toHaveBeenCalled()
  })

  it('ne copie rien quand l utilisateur annule', async () => {
    const share = vi.fn().mockRejectedValue(new DOMException('annulé', 'AbortError'))
    const writeText = vi.fn()
    stubNavigator({ share, clipboard: { writeText } })

    // Même convention que `shareOrDownload` : une annulation n est pas un échec, et
    // rien ne doit atterrir dans le presse-papier dans le dos de l utilisateur.
    expect(await shareLink(URL_TO_SHARE, 'b4after')).toBe('cancelled')
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copie quand le partage natif est absent', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ clipboard: { writeText } })

    expect(await shareLink(URL_TO_SHARE, 'b4after')).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(URL_TO_SHARE)
  })

  it('copie quand le partage échoue vraiment', async () => {
    const share = vi.fn().mockRejectedValue(new Error('boom'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubNavigator({ share, clipboard: { writeText } })

    expect(await shareLink(URL_TO_SHARE, 'b4after')).toBe('copied')
    expect(writeText).toHaveBeenCalledWith(URL_TO_SHARE)
  })

  it('rend failed quand le presse-papier refuse', async () => {
    const writeText = vi.fn().mockRejectedValue(new DOMException('refusé', 'NotAllowedError'))
    stubNavigator({ clipboard: { writeText } })

    expect(await shareLink(URL_TO_SHARE, 'b4after')).toBe('failed')
  })

  it('rend failed quand ni partage ni presse-papier ne sont disponibles', async () => {
    stubNavigator({})

    expect(await shareLink(URL_TO_SHARE, 'b4after')).toBe('failed')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/share/shareLink.test.ts`
Expected: FAIL — `Failed to resolve import "./shareLink"`.

- [ ] **Step 3: Write minimal implementation**

Créer `src/share/shareLink.ts` :

```ts
/**
 * Partage une URL par le partage natif, sinon la copie dans le presse-papier.
 *
 * Distinct de `shareOrDownload` : `navigator.share({ files })` et
 * `navigator.share({ url })` sont deux formes d appel différentes, et le repli n est
 * pas le même — un lien se copie, il ne se télécharge pas. Même convention en
 * revanche sur l annulation : ce n est pas un échec, et on ne fait rien derrière le
 * dos de l utilisateur.
 */
export async function shareLink(
  url: string,
  title: string,
): Promise<'shared' | 'copied' | 'cancelled' | 'failed'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, url })
      return 'shared'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
      // Un vrai échec de partage : on tente quand même de rendre le lien utilisable.
    }
  }

  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(url)
      return 'copied'
    } catch {
      return 'failed'
    }
  }

  return 'failed'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/share/shareLink.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/share/shareLink.ts src/share/shareLink.test.ts
git commit -m "feat: partage d'un lien avec repli sur le presse-papier"
```

---

### Task 3: L'écran À propos

**Files:**
- Create: `src/ui/AboutScreen.tsx`
- Modify: `src/App.tsx`
- Modify: `src/ui/SettingsScreen.tsx`
- Test: `e2e/flow.spec.ts`

**Interfaces:**
- Consumes: `__APP_VERSION__`, `__BUILD_DATE__`, `__COMMIT_SHA__` (Task 1) ; `shareLink` (Task 2) ; `formatDate` de `@/lib/format` ; `Screen` de `./components/Screen`.
- Produces: la route `/about`, les `data-testid` `about-link`, `app-version`, `build-date`, `commit-sha`, `share-app`, `share-status`.

- [ ] **Step 1: Write the failing test**

Dans `e2e/flow.spec.ts`, **retirer** la ligne `await expect(page.getByTestId('app-version')).toBeVisible()` du test « affiche l'état du stockage dans les réglages » — l'information déménage, l'assertion la suit — puis ajouter juste après ce test :

```ts
test('présente le projet et sa version sur la page À propos', async ({ page }) => {
  await page.getByRole('button', { name: "J'ai compris" }).click()
  await page.getByRole('link', { name: 'Réglages' }).click()
  await page.getByTestId('about-link').click()

  // Un numéro de version affiché, quel qu il soit : le figer ici obligerait à
  // toucher ce test à chaque montée de version.
  await expect(page.getByTestId('app-version')).toContainText(/\d+\.\d+\.\d+/)
  await expect(page.getByTestId('build-date')).toContainText(/\d{2}\/\d{2}\/\d{4}/)
  // Le serveur de test tourne depuis le dépôt : la révision est réelle, pas 'dev'.
  await expect(page.getByTestId('commit-sha')).not.toBeEmpty()
  await expect(page.getByRole('link', { name: /github/i })).toHaveAttribute(
    'href',
    'https://github.com/pleymor/b4after',
  )
  await expect(page.getByTestId('share-app')).toBeVisible()
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx playwright test e2e/flow.spec.ts -g "page À propos"`
Expected: FAIL — `about-link` introuvable dans les Réglages.

- [ ] **Step 3: Écrire l'écran**

Créer `src/ui/AboutScreen.tsx` :

```tsx
import { useState } from 'react'
import { Link } from 'react-router'
import { formatDate } from '@/lib/format'
import { shareLink } from '@/share/shareLink'
import { Screen } from './components/Screen'

const REPO_URL = 'https://github.com/pleymor/b4after'

/** Messages du partage. Un partage réussi ou annulé ne mérite rien de plus. */
const SHARE_MESSAGES = {
  shared: null,
  cancelled: null,
  copied: 'Lien copié.',
  failed: 'Le partage a échoué.',
} as const

export function AboutScreen() {
  const [shareStatus, setShareStatus] = useState<string | null>(null)

  // Une constante de build absente d un bundle bricolé donnerait `NaN/NaN/NaN` : on
  // préfère ne pas rendre la ligne du tout.
  const buildTimestamp = Date.parse(__BUILD_DATE__)
  const buildDate = Number.isNaN(buildTimestamp) ? null : formatDate(buildTimestamp)

  async function share() {
    // `window.location.origin` plutôt qu un domaine codé en dur : le lien partagé est
    // celui par lequel on a ouvert l application, donc joignable, et il n y a pas de
    // constante à corriger le jour d un déménagement.
    const outcome = await shareLink(window.location.origin, 'b4after')
    setShareStatus(SHARE_MESSAGES[outcome])
  }

  return (
    <Screen
      title="À propos"
      back={
        <Link to="/settings" className="text-sm text-slate-300">
          Retour
        </Link>
      }
    >
      <div className="space-y-6 p-4 text-sm">
        <section className="space-y-2">
          <h2 className="font-semibold text-slate-200">Le projet</h2>
          <p className="text-slate-300">
            b4after sert à reprendre une photo sous le même angle qu'une photo précédente,
            puis à en générer des comparaisons avant/après. Elle a été pensée pour documenter
            un chantier : la photo de référence se superpose au flux caméra pour retrouver le
            cadrage, et un écran de calage permet d'ajuster au doigt.
          </p>
          <p className="text-slate-300">
            Tout reste sur cet appareil. Aucun compte, aucun serveur, aucun appel réseau une
            fois l'application installée.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-slate-200">L'auteur</h2>
          <p className="text-slate-300">
            Écrite par Pleymor. Le code est ouvert :{' '}
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="text-sky-400 underline"
            >
              github.com/pleymor/b4after
            </a>
          </p>
        </section>

        <section className="space-y-1">
          <h2 className="font-semibold text-slate-200">Version</h2>
          <p data-testid="app-version" className="text-slate-300">
            Version {__APP_VERSION__}
          </p>
          {buildDate && (
            <p data-testid="build-date" className="text-slate-400">
              Mise en ligne le {buildDate}
            </p>
          )}
          <p data-testid="commit-sha" className="text-slate-500">
            Révision {__COMMIT_SHA__}
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="font-semibold text-slate-200">Partager</h2>
          <button
            type="button"
            data-testid="share-app"
            onClick={share}
            className="rounded-xl border border-slate-600 px-4 py-2"
          >
            Partager l'application
          </button>
          {shareStatus && (
            <p data-testid="share-status" className="text-slate-300">
              {shareStatus}
            </p>
          )}
        </section>
      </div>
    </Screen>
  )
}
```

- [ ] **Step 4: Déclarer la route**

Dans `src/App.tsx`, ajouter l'import `import { AboutScreen } from './ui/AboutScreen'`
(en respectant l'ordre alphabétique des imports existants, donc en première position du
groupe `./ui/`) et la route, avant celle des réglages :

```tsx
        <Route path="/about" element={<AboutScreen />} />
```

- [ ] **Step 5: Faire déménager la ligne de version**

Dans `src/ui/SettingsScreen.tsx`, remplacer le paragraphe final :

```tsx
        <p data-testid="app-version" className="text-slate-500">
          Version {__APP_VERSION__}
        </p>
```

par :

```tsx
        {/* La version, la date de build et la révision vivent sur la page À propos, et
            là seulement : dupliquer l information ici la ferait diverger. */}
        <Link to="/about" data-testid="about-link" className="block text-sky-400 underline">
          À propos de b4after
        </Link>
```

`Link` est déjà importé dans ce fichier.

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx tsc -b && npm run lint && npx playwright test e2e/flow.spec.ts -g "À propos|stockage dans les réglages"`
Expected: PASS — les deux tests.

- [ ] **Step 7: Passer toute la suite**

Run: `npm test && npx playwright test`
Expected: PASS. `e2e/offline.spec.ts` tourne sur un vrai build : c'est lui qui confirme
que l'injection des constantes ne casse pas le bundle de production ni le service worker.

- [ ] **Step 8: Vérifier de visu**

`npm run dev`, aller dans Réglages puis À propos, et taper sur « Partager
l'application ». Sur un navigateur de bureau sans partage natif, le lien doit atterrir
dans le presse-papier et « Lien copié. » s'afficher. Vérifier aussi que la date affichée
est bien celle du jour.

- [ ] **Step 9: Commit**

```bash
git add src/ui/AboutScreen.tsx src/ui/SettingsScreen.tsx src/App.tsx e2e/flow.spec.ts
git commit -m "feat: page À propos avec version, révision et partage du lien"
```

---

## Notes d'exécution

- **La date change à chaque build.** C'est voulu. Ne pas la figer pour « stabiliser »
  l'empreinte du bundle : la page cesserait de dire la vérité, qui est sa seule raison
  d'être.
- **`npm_package_version` dépend de npm.** Un `npx vite build` direct rendrait
  `0.0.0`. Toujours passer par `npm run build`, ce que fait déjà la CI.
- **Ordre imposé.** La Task 1 doit précéder la Task 3 : sans les déclarations de
  `vite-env.d.ts`, `AboutScreen` ne compile pas.
