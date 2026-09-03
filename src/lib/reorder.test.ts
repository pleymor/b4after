import { describe, expect, it } from 'vitest'
import { moveBy, moveOnto } from './reorder'

const list = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]
const ids = (items: { id: string }[]) => items.map((item) => item.id)

describe('moveOnto', () => {
  it('descend un élément à la place du survolé', () => {
    expect(ids(moveOnto(list, 'a', 'c'))).toEqual(['b', 'c', 'a', 'd'])
  })

  it('remonte un élément à la place du survolé', () => {
    expect(ids(moveOnto(list, 'd', 'b'))).toEqual(['a', 'd', 'b', 'c'])
  })

  it('renvoie le tableau reçu quand la cible est l élément lui-même', () => {
    expect(moveOnto(list, 'b', 'b')).toBe(list)
  })

  it('renvoie le tableau reçu sur un identifiant inconnu', () => {
    // Le survol peut tomber sur une ligne qui vient d être supprimée.
    expect(moveOnto(list, 'b', 'z')).toBe(list)
    expect(moveOnto(list, 'z', 'b')).toBe(list)
  })

  it('ne perd ni ne duplique d élément', () => {
    expect(ids(moveOnto(list, 'c', 'a')).sort()).toEqual(['a', 'b', 'c', 'd'])
  })
})

describe('moveBy', () => {
  it('décale d un rang vers le bas', () => {
    expect(ids(moveBy(list, 'a', 1))).toEqual(['b', 'a', 'c', 'd'])
  })

  it('décale d un rang vers le haut', () => {
    expect(ids(moveBy(list, 'c', -1))).toEqual(['a', 'c', 'b', 'd'])
  })

  it('borne aux extrémités plutôt que de boucler', () => {
    // Sans la borne, le premier élément repasserait en fin de série : la flèche
    // « monter » ferait descendre.
    expect(moveBy(list, 'a', -1)).toBe(list)
    expect(moveBy(list, 'd', 1)).toBe(list)
  })

  it('accepte un décalage de plusieurs rangs', () => {
    expect(ids(moveBy(list, 'a', 2))).toEqual(['b', 'c', 'a', 'd'])
  })

  it('renvoie le tableau reçu sur un identifiant inconnu', () => {
    expect(moveBy(list, 'z', 1)).toBe(list)
  })
})
