import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { getContext } from '@/lib/context'
import { CALENDAR_SCOPE } from '@/lib/google'

// Admin-only: starts the one-time Google Calendar connection.
export async function GET() {
  const ctx = await getContext()
  const appUrl = process.env.APP_URL!
  if (!ctx.isAdmin) return NextResponse.redirect(`${appUrl}/settings?error=admin_only`)

  const state = randomBytes(24).toString('base64url')
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${appUrl}/api/google/callback`,
    response_type: 'code',
    scope: `openid email ${CALENDAR_SCOPE}`,
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'false',
    login_hint: ctx.email,
    state,
  })

  const res = NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`)
  res.cookies.set('gcal_state', `${state}.${ctx.circle.id}`, {
    httpOnly: true,
    secure: appUrl.startsWith('https'),
    sameSite: 'lax',
    path: '/api/google',
    maxAge: 600,
  })
  return res
}
