import { describe, expect, it } from 'vitest'
import { formatDate } from './format'

describe('formatDate', () => {
  it('formate en JJ/MM/AAAA', () => {
    expect(formatDate(Date.UTC(2026, 6, 31, 12))).toBe('31/07/2026')
  })

  it('complète les jours et mois à un chiffre', () => {
    expect(formatDate(Date.UTC(2026, 0, 5, 12))).toBe('05/01/2026')
  })
})
