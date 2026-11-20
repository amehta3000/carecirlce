import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import type { AgendaEvent, Circle, Member } from '@/lib/types'

/**
 * The narrowest Calendar scope Google offers: the app can create its own
 * secondary calendar and manage events on THAT calendar only. It cannot read
 * or touch anything else in the connected account.
 */
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'
const API = 'https://www.googleapis.com/calendar/v3'

export class CalendarNotConnected extends Error {
  constructor() {
    super('Google Calendar is not connected yet.')
  }
}

type Connection = { calendar_id: string | null; refresh_token_enc: string; google_email: string }

async function getConnection(circleId: string): Promise<Connection | null> {
  const admin = createServiceClient()
  const { data } = await admin
    .from('google_connections')
    .select('calendar_id, refresh_token_enc, google_email')
    .eq('circle_id', circleId)
    .maybeSingle()
  return data
}

// Short-lived access tokens, cached in memory per server instance.
const tokenCache = new Map<string, { token: string; exp: number }>()

async function accessToken(circleId: string, conn: Connection): Promise<string> {
  const hit = tokenCache.get(circleId)
  if (hit && hit.exp > Date.now() + 60_000) return hit.token

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: decrypt(conn.refresh_token_enc),
      grant_type: 'refresh_token',
    }),
    cache: 'no-store',
  })
  if (!res.ok) {
    const body = await res.text()
    if (body.includes('invalid_grant')) {
      throw new Error(
        'Google Calendar access was revoked or expired. An admin needs to reconnect it in Settings.',
      )
    }
    throw new Error(`Google token refresh failed (${res.status})`)
  }
  const json = (await res.json()) as { access_token: string; expires_in: number }
  tokenCache.set(circleId, { token: json.access_token, exp: Date.now() + json.expires_in * 1000 })
  return json.access_token
}

async function gcal<T>(circleId: string, path: string, init: RequestInit = {}): Promise<T> {
  const conn = await getConnection(circleId)
  if (!conn) throw new CalendarNotConnected()
  const token = await accessToken(circleId, conn)
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
    cache: 'no-store',
  })
  if (res.status === 204) return undefined as T
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`Google Calendar error ${res.status}: ${text.slice(0, 200)}`)
  }
  return (await res.json()) as T
}

/** Create the dedicated "<Name>'s Care" calendar in the connected account. */
export async function createCareCalendar(accessTok: string, circle: Circle): Promise<string> {
  const res = await fetch(`${API}/calendars`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      summary: `${circle.patient_name} · Care`,
      description: 'Medical appointments managed by CareCircle. Edits here sync back to the app.',
      timeZone: circle.timezone,
    }),
  })
  if (!res.ok) throw new Error(`Could not create calendar (${res.status})`)
  const json = (await res.json()) as { id: string }
  return json.id
}

export async function isConnected(circleId: string) {
  const conn = await getConnection(circleId)
  return !!conn?.calendar_id
}

type EventInput = {
  title: string
  startLocal: string // 'YYYY-MM-DDTHH:mm' in circle timezone
  endLocal: string
  timezone: string
  location?: string | null
  description: string
  careItemId: string
  attendees: Member[]
}

function eventBody(e: EventInput) {
  return {
    summary: e.title,
    location: e.location || undefined,
    description: e.description,
    start: { dateTime: `${e.startLocal}:00`, timeZone: e.timezone },
    end: { dateTime: `${e.endLocal}:00`, timeZone: e.timezone },
    attendees: e.attendees
      .filter((m) => m.calendar_invites && m.email)
      .map((m) => ({ email: m.email, displayName: m.display_name || undefined })),
    guestsCanModify: true,
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 24 * 60 },
        { method: 'popup', minutes: 120 },
      ],
    },
    extendedProperties: { private: { careItemId: e.careItemId, source: 'carecircle' } },
  }
}

/** Create or update the event for a care item. Returns the event id. */
export async function upsertEvent(circleId: string, existingId: string | null, e: EventInput) {
  const conn = await getConnection(circleId)
  if (!conn?.calendar_id) throw new CalendarNotConnected()
  const cal = encodeURIComponent(conn.calendar_id)
  // sendUpdates=all emails family guests when a time changes. That's the point.
  if (existingId) {
    const ev = await gcal<{ id: string }>(
      circleId,
      `/calendars/${cal}/events/${encodeURIComponent(existingId)}?sendUpdates=all`,
      { method: 'PATCH', body: JSON.stringify(eventBody(e)) },
    )
    return ev.id
  }
  const ev = await gcal<{ id: string }>(circleId, `/calendars/${cal}/events?sendUpdates=all`, {
    method: 'POST',
    body: JSON.stringify(eventBody(e)),
  })
  return ev.id
}

export async function deleteEvent(circleId: string, eventId: string) {
  const conn = await getConnection(circleId)
  if (!conn?.calendar_id) return
  const cal = encodeURIComponent(conn.calendar_id)
  try {
    await gcal(circleId, `/calendars/${cal}/events/${encodeURIComponent(eventId)}?sendUpdates=all`, {
      method: 'DELETE',
    })
  } catch (err) {
    // Already deleted in Google Calendar is fine.
    if (!(err instanceof Error) || !/40(4|10)/.test(err.message)) throw err
  }
}

type GEvent = {
  id: string
  status: string
  summary?: string
  location?: string
  htmlLink?: string
  start: { dateTime?: string; date?: string }
  end?: { dateTime?: string; date?: string }
  extendedProperties?: { private?: Record<string, string> }
}

/** Upcoming events on the care calendar, including ones added directly in Google. */
export async function listUpcoming(circleId: string, days = 60): Promise<AgendaEvent[]> {
  const conn = await getConnection(circleId)
  if (!conn?.calendar_id) throw new CalendarNotConnected()
  const cal = encodeURIComponent(conn.calendar_id)
  const now = new Date()
  const until = new Date(now.getTime() + days * 86_400_000)
  const params = new URLSearchParams({
    timeMin: new Date(now.getTime() - 6 * 3_600_000).toISOString(),
    timeMax: until.toISOString(),
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '100',
  })
  const data = await gcal<{ items: GEvent[] }>(circleId, `/calendars/${cal}/events?${params}`)
  return (data.items || [])
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({
      id: e.id,
      title: e.summary || '(untitled)',
      start: e.start.dateTime || e.start.date || '',
      end: e.end?.dateTime || e.end?.date || null,
      allDay: !e.start.dateTime,
      location: e.location || null,
      htmlLink: e.htmlLink || null,
      careItemId: e.extendedProperties?.private?.careItemId || null,
    }))
}
