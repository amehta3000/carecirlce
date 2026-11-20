import { NextResponse, type NextRequest } from 'next/server'
import { timingSafeEqual } from 'crypto'
import { getContext } from '@/lib/context'
import { createServiceClient } from '@/lib/supabase/server'
import { encrypt } from '@/lib/crypto'
import { CALENDAR_SCOPE, createCareCalendar } from '@/lib/google'

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL!
  const back = (q: string) => {
    const res = NextResponse.redirect(`${appUrl}/settings?${q}`)
    res.cookies.delete({ name: 'gcal_state', path: '/api/google' })
    return res
  }

  const ctx = await getContext()
  if (!ctx.isAdmin) return back('error=admin_only')

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state') || ''
  const [cookieState, cookieCircle] = (req.cookies.get('gcal_state')?.value || '').split('.')
  if (req.nextUrl.searchParams.get('error')) return back('error=declined')
  if (!code || !cookieState || !safeEqual(state, cookieState) || cookieCircle !== ctx.circle.id) {
    return back('error=state')
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${appUrl}/api/google/callback`,
      grant_type: 'authorization_code',
    }),
  })
  if (!tokenRes.ok) return back('error=exchange')
  const tok = (await tokenRes.json()) as {
    access_token: string
    refresh_token?: string
    scope: string
    id_token?: string
  }
  if (!tok.scope.split(' ').includes(CALENDAR_SCOPE)) return back('error=scope')
  if (!tok.refresh_token) return back('error=no_refresh')

  // The id_token came straight from Google's token endpoint over TLS, so its
  // payload can be read without separate signature verification.
  let googleEmail = ctx.email
  if (tok.id_token) {
    try {
      const payload = JSON.parse(Buffer.from(tok.id_token.split('.')[1], 'base64url').toString())
      if (payload.email) googleEmail = payload.email
    } catch {}
  }

  const admin = createServiceClient()
  const { data: existing } = await admin
    .from('google_connections')
    .select('calendar_id')
    .eq('circle_id', ctx.circle.id)
    .maybeSingle()

  // Reuse the existing care calendar when reconnecting the same account;
  // otherwise make a new one.
  let calendarId = existing?.calendar_id ?? null
  if (calendarId) {
    const check = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}`,
      { headers: { Authorization: `Bearer ${tok.access_token}` } },
    )
    if (!check.ok) calendarId = null
  }
  if (!calendarId) calendarId = await createCareCalendar(tok.access_token, ctx.circle)

  const { error } = await admin.from('google_connections').upsert({
    circle_id: ctx.circle.id,
    google_email: googleEmail,
    calendar_id: calendarId,
    refresh_token_enc: encrypt(tok.refresh_token),
    scope: tok.scope,
    connected_by: ctx.userId,
    connected_at: new Date().toISOString(),
  })
  if (error) return back('error=save')

  return back('connected=1')
}
