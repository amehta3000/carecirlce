import { addMinutes, format, parse } from 'date-fns'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

/** 'YYYY-MM-DD' + 'HH:mm' in tz → UTC ISO string */
export function localToUtcISO(date: string, time: string, tz: string) {
  return fromZonedTime(`${date}T${time}:00`, tz).toISOString()
}

/** Add minutes to a naive local 'YYYY-MM-DDTHH:mm' string. */
export function addLocalMinutes(local: string, minutes: number) {
  const d = parse(local, "yyyy-MM-dd'T'HH:mm", new Date(0))
  return format(addMinutes(d, minutes), "yyyy-MM-dd'T'HH:mm")
}

export function fmtInTz(iso: string, tz: string, pattern: string) {
  return formatInTimeZone(new Date(iso), tz, pattern)
}

export function todayInTz(tz: string) {
  return formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
}

/** Whole days from today (in tz) until a 'YYYY-MM-DD' date. Negative = overdue. */
export function daysUntil(dateStr: string, tz: string) {
  const today = new Date(`${todayInTz(tz)}T00:00:00Z`).getTime()
  const target = new Date(`${dateStr}T00:00:00Z`).getTime()
  return Math.round((target - today) / 86_400_000)
}

export function dueLabel(dateStr: string | null, hint: string | null, tz: string) {
  if (!dateStr) return hint ? `Paper says: ${hint}` : null
  const d = daysUntil(dateStr, tz)
  const pretty = formatInTimeZone(new Date(`${dateStr}T12:00:00Z`), 'UTC', 'MMM d')
  if (d < 0) return `Overdue · was due ${pretty}`
  if (d === 0) return 'Due today'
  if (d === 1) return 'Due tomorrow'
  if (d <= 14) return `Due in ${d} days · ${pretty}`
  return `Due by ${pretty}`
}
