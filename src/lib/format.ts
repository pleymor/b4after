/** Formate un timestamp epoch ms en JJ/MM/AAAA, dans le fuseau local. */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${date.getFullYear()}`
}

/** Formate un timestamp epoch ms en JJ/MM/AAAA à HH:MM, dans le fuseau local. */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp)
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${formatDate(timestamp)} à ${hours}:${minutes}`
}
