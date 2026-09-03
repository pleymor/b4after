/**
 * Déplacements dans une liste ordonnée, en dehors de toute affaire de pointeur ou de
 * base : c est la seule partie du réordonnancement qui mérite d être vérifiée cas par
 * cas, et la seule qui se prête à un test unitaire.
 *
 * Les deux fonctions renvoient le tableau reçu, à l identique, quand rien ne bouge :
 * l appelant peut donc comparer les références pour savoir s il a quelque chose à
 * enregistrer.
 */

type Identified = { id: string }

function move<T>(items: T[], from: number, to: number): T[] {
  const next = items.slice()
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Place `id` au rang qu occupe `targetId`, les éléments intermédiaires reculant ou
 * avançant d un rang. C est le geste du glisser-déposer : la ligne survolée cède sa
 * place à la ligne traînée.
 */
export function moveOnto<T extends Identified>(items: T[], id: string, targetId: string): T[] {
  const from = items.findIndex((item) => item.id === id)
  const to = items.findIndex((item) => item.id === targetId)
  if (from === -1 || to === -1 || from === to) return items
  return move(items, from, to)
}

/**
 * Décale `id` de `delta` rangs, borné aux extrémités — le clavier n a pas de position
 * survolée à viser. Buter en haut ou en bas ne renvoie pas un nouveau tableau : une
 * flèche maintenue ne déclenche donc pas une rafale d écritures inutiles.
 */
export function moveBy<T extends Identified>(items: T[], id: string, delta: number): T[] {
  const from = items.findIndex((item) => item.id === id)
  if (from === -1) return items
  const to = Math.min(items.length - 1, Math.max(0, from + delta))
  if (to === from) return items
  return move(items, from, to)
}
