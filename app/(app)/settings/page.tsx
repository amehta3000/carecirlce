import { getContext } from '@/lib/context'
import { createClient } from '@/lib/supabase/server'
import { fmtInTz } from '@/lib/dates'
import { InviteForm, MemberRow, InviteRow, CalendarToggle, DisconnectCalendar } from '@/components/SettingsControls'
import type { Invite } from '@/lib/types'

export const dynamic = 'force-dynamic'

const ERRORS: Record<string, string> = {
  admin_only: 'Only an admin can connect Google Calendar.',
  declined: 'Google access wasn’t granted.',
  state: 'That sign-in link expired. Please try again.',
  exchange: 'Google didn’t accept the sign-in. Please try again.',
  scope: 'Calendar permission wasn’t granted. Please tick the calendar box on Google’s screen.',
  no_refresh: 'Google didn’t return long-term access. Remove CareCircle at myaccount.google.com/permissions, then try again.',
  save: 'Couldn’t save the connection.',
}

export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string; welcome?: string }>
}) {
  const sp = await searchParams
  const ctx = await getContext()
  const supabase = await createClient()
  const [{ data: cal }, { data: invites }] = await Promise.all([
    supabase.rpc('calendar_status', { c: ctx.circle.id }),
    ctx.isAdmin
      ? supabase.from('circle_invites').select('*').eq('circle_id', ctx.circle.id).is('accepted_at', null).order('created_at')
      : Promise.resolve({ data: [] as Invite[] }),
  ])
  const connection = (cal as { google_email: string; calendar_id: string | null; connected_at: string }[] | null)?.[0]
  const tz = ctx.circle.timezone

  return (
    <div className="stack">
      <h1 className="display" style={{ fontSize: 32 }}>Family</h1>

      {sp.welcome && (
        <p className="notice ok" style={{ marginTop: 16 }}>
          Your care circle is ready. Two steps left: connect Google Calendar, then invite your family.
        </p>
      )}
      {sp.connected && <p className="notice ok" style={{ marginTop: 16 }}>Google Calendar connected.</p>}
      {sp.error && <p className="notice error" style={{ marginTop: 16 }}>{ERRORS[sp.error] || 'Something went wrong.'}</p>}

      <h2 className="section-title" id="calendar">Google Calendar</h2>
      <div className="card stack gap-12">
        {connection?.calendar_id ? (
          <>
            <p>
              Appointments go on the <strong>{ctx.circle.patient_name} · Care</strong> calendar in{' '}
              <strong>{connection.google_email}</strong>. Everyone with invites turned on is added as a guest, so it shows
              in their own calendar with reminders a day before and two hours before.
            </p>
            <p className="tiny faint">Connected {fmtInTz(connection.connected_at, tz, 'MMM d, yyyy')}</p>
            {ctx.isAdmin && (
              <div className="row wrap">
                <a href="/api/google/connect" className="btn secondary sm">Reconnect</a>
                <DisconnectCalendar />
              </div>
            )}
          </>
        ) : ctx.isAdmin ? (
          <>
            <p>
              Connect once. CareCircle creates a separate <strong>{ctx.circle.patient_name} · Care</strong> calendar in your
              Google account and can only see that calendar, nothing else.
            </p>
            <a href="/api/google/connect" className="btn primary">Connect Google Calendar</a>
          </>
        ) : (
          <p className="muted">Not connected yet. An admin needs to connect it.</p>
        )}
        <CalendarToggle on={ctx.me.calendar_invites} />
      </div>

      <h2 className="section-title">People ({ctx.members.length})</h2>
      <div className="list">
        {ctx.members.map((m) => (
          <MemberRow key={m.user_id} member={m} isMe={m.user_id === ctx.userId} canManage={ctx.isAdmin} />
        ))}
        {((invites as Invite[]) || []).map((inv) => <InviteRow key={inv.id} invite={inv} />)}
      </div>

      {ctx.isAdmin && (
        <>
          <h2 className="section-title">Invite someone</h2>
          <div className="card">
            <InviteForm />
          </div>
          <div className="card small muted stack gap-4" style={{ marginTop: 12 }}>
            <p><strong style={{ color: 'var(--ink)' }}>Admin</strong> manages people and the calendar connection.</p>
            <p><strong style={{ color: 'var(--ink)' }}>Editor</strong> scans papers, books appointments, updates meds.</p>
            <p><strong style={{ color: 'var(--ink)' }}>Viewer</strong> sees everything, changes nothing.</p>
          </div>
        </>
      )}

      <h2 className="section-title">Account</h2>
      <div className="card row between wrap">
        <span className="small">Signed in as {ctx.email}</span>
        <form action="/auth/signout" method="post">
          <button className="btn secondary sm">Sign out</button>
        </form>
      </div>
    </div>
  )
}
