import { describe, expect, it } from 'vitest'
import { fittedFontSize } from './sideBySide'

describe('fittedFontSize', () => {
  it('rend la taille de départ inchangée quand elle tient déjà dans la largeur', () => {
    // `measure` constant, indépendant de `size` : tient dès la première mesure, la
    // boucle ne doit donc jamais se déclencher.
    expect(fittedFontSize(() => 10, 20, 14)).toBe(14)
  })

  it('réduit la taille jusqu à ce que la mesure tienne dans la largeur', () => {
    // `measure` proportionnel à `size` : au-delà de 10 px la largeur dépasse 50,
    // à 10 px exactement elle vaut 50, ce qui tient (comparaison stricte `>`).
    expect(fittedFontSize((size) => size * 5, 50, 14)).toBe(10)
  })

  it('s arrête au plancher de 6 px et termine même si rien ne tient jamais', () => {
    // `measure` renvoie toujours une valeur énorme : sans le plancher, la boucle ne
    // se terminerait jamais. C est la garantie de terminaison, pas le cas nominal.
    expect(fittedFontSize(() => 10_000, 50, 14)).toBe(6)
  })
})
