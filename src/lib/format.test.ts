import { describe, expect, it } from 'vitest'
import { formatDate, formatDateTime } from './format'

describe('formatDate', () => {
  it('formate en JJ/MM/AAAA', () => {
    expect(formatDate(Date.UTC(2026, 6, 31, 12))).toBe('31/07/2026')
  })

  it('complète les jours et mois à un chiffre', () => {
    expect(formatDate(Date.UTC(2026, 0, 5, 12))).toBe('05/01/2026')
  })
})

describe('formatDateTime', () => {
  it('formate en JJ/MM/AAAA à HH:MM', () => {
    // Date construite en heure **locale**, pas en UTC : la fonction lit `getHours`,
    // donc un timestamp UTC donnerait une heure différente selon le fuseau de la
    // machine de test et ce test échouerait ailleurs qu'à Paris.
    expect(formatDateTime(new Date(2026, 6, 31, 14, 5).getTime())).toBe('31/07/2026 à 14:05')
  })

  it('complète les heures et minutes à un chiffre', () => {
    expect(formatDateTime(new Date(2026, 0, 5, 9, 7).getTime())).toBe('05/01/2026 à 09:07')
  })

  it('affiche minuit sans le confondre avec midi', () => {
    expect(formatDateTime(new Date(2026, 0, 5, 0, 0).getTime())).toBe('05/01/2026 à 00:00')
  })
})
