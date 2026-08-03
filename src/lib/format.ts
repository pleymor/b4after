/** Formate un timestamp epoch ms en JJ/MM/AAAA, dans le fuseau local. */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${date.getFullYear()}`
}
