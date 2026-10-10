const dateTime = new Intl.DateTimeFormat('ro-RO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

/** "4 oct. 2026 14:32", in the device's time zone. */
export function formatDateTime(date: Date): string {
  const parts = Object.fromEntries(dateTime.formatToParts(date).map((p) => [p.type, p.value]))
  return `${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}`
}

const relative = new Intl.RelativeTimeFormat('ro', { numeric: 'auto' })

/** Each unit and how many of it make the next one. */
const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['minute', 60],
  ['hour', 24],
  ['day', 7],
  ['week', 4.35],
  ['month', 12],
  ['year', Infinity],
]

/**
 * "acum 5 minute", "ieri", "acum 3 luni". Under a minute it returns null and the caller shows
 * its own "chiar acum" (Intl would say "acum 0 de secunde").
 */
export function formatRelative(iso: string, now: number): string | null {
  let value = (Date.parse(iso) - now) / 60_000
  if (Number.isNaN(value) || Math.abs(value) < 1) return null
  for (const [unit, size] of UNITS) {
    if (Math.abs(value) < size) return relative.format(Math.trunc(value), unit)
    value /= size
  }
  return null
}
