import Link from 'next/link'
import { AlertTriangle, Camera, ExternalLink, Plus } from 'lucide-react'
import { getContext } from '@/lib/context'
import { createClient } from '@/lib/supabase/server'
import { CalendarNotConnected, listUpcoming } from '@/lib/google'
import { fmtInTz } from '@/lib/dates'
import { ItemCard } from '@/components/ItemCard'
import type { AgendaEvent, CareItem, CareNote } from '@/lib/types'

export const dynamic = 'force-dynamic'

const urgencyRank = { urgent: 0, soon: 1, routine: 2 } as const

export default async function Today() {
  const ctx = await getContext()
  const supabase = await createClient()
  const tz = ctx.circle.timezone

  const [{ data: items }, { data: warnings }] = await Promise.all([
    supabase
      .from('care_items')
      .select('*, providers(*)')
      .eq('circle_id', ctx.circle.id)
      .in('status', ['to_schedule', 'scheduled'])
      .order('due_by', { ascending: true, nullsFirst: false }),
    supabase
      .from('care_notes')
      .select('*')
      .eq('circle_id', ctx.circle.id)
      .eq('active', true)
      .eq('is_warning', true)
      .order('created_at', { ascending: false }),
  ])

  const all = (items as CareItem[]) || []
  const queue = all
    .filter((i) => i.status === 'to_schedule')
    .sort((a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency] || (a.due_by || '9999').localeCompare(b.due_by || '9999'))
  const scheduled = all.filter((i) => i.status === 'scheduled')

  // Google Calendar is the source of truth for confirmed times.
  let agenda: AgendaEvent[] = []
  let calendarState: 'ok' | 'not_connected' | 'error' = 'ok'
  let calendarError = ''
  try {
    agenda = await listUpcoming(ctx.circle.id, 60)
  } catch (e) {
    if (e instanceof CalendarNotConnected) calendarState = 'not_connected'
    else {
      calendarState = 'error'
      calendarError = (e as Error).message
    }
  }

  // If someone moved an appointment in Google Calendar, copy the new time back.
  if (calendarState === 'ok' && ctx.canEdit) {
    const byId = new Map(scheduled.map((i) => [i.id, i]))
    await Promise.all(
      agenda
        .filter((ev) => ev.careItemId && byId.has(ev.careItemId) && !ev.allDay)
        .filter((ev) => new Date(ev.start).getTime() !== new Date(byId.get(ev.careItemId!)!.scheduled_start || 0).getTime())
        .map((ev) =>
          supabase
            .from('care_items')
            .update({ scheduled_start: ev.start, scheduled_end: ev.end, location: ev.location })
            .eq('id', ev.careItemId!),
        ),
    )
  }

  // When the calendar isn't reachable, fall back to what the app knows.
  if (calendarState !== 'ok') {
    agenda = scheduled
      .filter((i) => i.scheduled_start)
      .sort((a, b) => a.scheduled_start!.localeCompare(b.scheduled_start!))
      .map((i) => ({
        id: i.id,
        title: i.title,
        start: i.scheduled_start!,
        end: i.scheduled_end,
        allDay: false,
        location: i.location,
        htmlLink: null,
        careItemId: i.id,
      }))
  }

  const nameOf = (uid: string | null) =>
    uid && uid !== ctx.userId ? ctx.members.find((m) => m.user_id === uid)?.display_name?.split(' ')[0] : undefined
  const prepFor = (careItemId: string | null) => scheduled.find((i) => i.id === careItemId)?.prep_instructions

  return (
    <div className="stack">
      <div className="stack gap-4">
        <p className="muted small">{fmtInTz(new Date().toISOString(), tz, 'EEEE, MMMM d')}</p>
        <h1 className="display" style={{ fontSize: 32, lineHeight: 1.1 }}>
          {queue.length === 0
            ? 'Nothing waiting to be booked'
            : `${queue.length} ${queue.length === 1 ? 'thing needs' : 'things need'} booking`}
        </h1>
      </div>

      {(warnings as CareNote[] | null)?.length ? (
        <div className="notice warn stack gap-8" style={{ marginTop: 16 }}>
          <div className="row" style={{ fontWeight: 700 }}>
            <AlertTriangle size={20} aria-hidden /> Call the doctor if…
          </div>
          <ul style={{ margin: 0, paddingLeft: 22 }}>
            {(warnings as CareNote[]).map((w) => (
              <li key={w.id}>{w.body}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {calendarState === 'not_connected' && (
        <div className="notice info row between wrap" style={{ marginTop: 16 }}>
          <span>Google Calendar isn&rsquo;t connected, so bookings won&rsquo;t reach anyone&rsquo;s calendar.</span>
          {ctx.isAdmin ? (
            <Link href="/settings#calendar" className="btn sm primary">Connect</Link>
          ) : (
            <span className="small">Ask an admin to connect it.</span>
          )}
        </div>
      )}
      {calendarState === 'error' && (
        <p className="notice error small" style={{ marginTop: 16 }}>
          Couldn&rsquo;t reach Google Calendar: {calendarError}
        </p>
      )}

      <h2 className="section-title">Needs booking</h2>
      {queue.length === 0 ? (
        <Link href="/scan" className="hero">
          <span className="icon-big"><Camera size={28} aria-hidden /></span>
          <span className="stack gap-4">
            <strong style={{ fontSize: 19 }}>Back from an appointment?</strong>
            <span style={{ opacity: 0.85 }}>Photograph the papers and we&rsquo;ll pull out what needs booking.</span>
          </span>
        </Link>
      ) : (
        <div className="list">
          {queue.map((item) => (
            <ItemCard key={item.id} item={item} tz={tz} updatedBy={nameOf(item.updated_by)} />
          ))}
        </div>
      )}
      {ctx.canEdit && (
        <div className="row" style={{ marginTop: 10 }}>
          <Link href="/items/new" className="btn ghost sm"><Plus size={18} aria-hidden /> Add one by hand</Link>
        </div>
      )}

      <h2 className="section-title">Coming up</h2>
      {agenda.length === 0 ? (
        <p className="empty small">No appointments on the calendar in the next two months.</p>
      ) : (
        <div className="list">
          {agenda.map((ev) => {
            const prep = prepFor(ev.careItemId)
            const inner = (
              <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
                <div className="datebadge">
                  <div className="m">{fmtInTz(ev.start, tz, 'MMM')}</div>
                  <div className="d">{fmtInTz(ev.start, tz, 'd')}</div>
                </div>
                <div className="grow stack gap-4">
                  <p style={{ fontWeight: 700, fontSize: 18, lineHeight: 1.3 }}>{ev.title}</p>
                  <p className="muted small">
                    {ev.allDay ? fmtInTz(ev.start, tz, 'EEEE') + ' · all day' : fmtInTz(ev.start, tz, "EEEE 'at' h:mm a")}
                    {ev.location ? ` · ${ev.location}` : ''}
                  </p>
                  {prep && <p className="small" style={{ color: 'var(--soon)' }}><strong>Prep:</strong> {prep}</p>}
                  {!ev.careItemId && ev.htmlLink && (
                    <a href={ev.htmlLink} target="_blank" rel="noreferrer" className="tiny faint row" style={{ gap: 4 }}>
                      Added in Google Calendar <ExternalLink size={12} aria-hidden />
                    </a>
                  )}
                </div>
              </div>
            )
            return ev.careItemId ? (
              <Link key={ev.id} href={`/items/${ev.careItemId}`} className="card">{inner}</Link>
            ) : (
              <div key={ev.id} className="card">{inner}</div>
            )
          })}
        </div>
      )}
    </div>
  )
}
