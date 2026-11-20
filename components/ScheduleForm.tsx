'use client'
import { useActionState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { scheduleItem, type ActionResult } from '@/app/actions'
import { fmtInTz } from '@/lib/dates'
import type { CareItem } from '@/lib/types'

const DURATIONS = [
  { v: 30, l: '30 minutes' },
  { v: 60, l: '1 hour' },
  { v: 90, l: '1½ hours' },
  { v: 120, l: '2 hours' },
  { v: 180, l: '3 hours' },
  { v: 240, l: 'Half day' },
]

export function ScheduleForm({ item, tz, calendarConnected }: { item: CareItem; tz: string; calendarConnected: boolean }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    scheduleItem.bind(null, item.id),
    null,
  )
  const booked = item.status === 'scheduled' && item.scheduled_start
  const defDate = booked ? fmtInTz(item.scheduled_start!, tz, 'yyyy-MM-dd') : ''
  const defTime = booked ? fmtInTz(item.scheduled_start!, tz, 'HH:mm') : '09:00'
  const defDur =
    booked && item.scheduled_end
      ? Math.round((new Date(item.scheduled_end).getTime() - new Date(item.scheduled_start!).getTime()) / 60000)
      : item.kind === 'lab'
        ? 30
        : 60

  return (
    <form action={action} className="card stack gap-16">
      <h2 style={{ fontSize: 20 }}>{booked ? 'Change the booking' : 'Booked it? Add the time'}</h2>
      <div className="grid-2">
        <label className="field">
          Date
          <input type="date" name="date" defaultValue={defDate} required />
        </label>
        <label className="field">
          Time
          <input type="time" name="time" defaultValue={defTime} required step={300} />
        </label>
      </div>
      <label className="field">
        How long
        <select name="duration" defaultValue={String(DURATIONS.some((d) => d.v === defDur) ? defDur : 60)}>
          {DURATIONS.map((d) => (
            <option key={d.v} value={d.v}>{d.l}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Where
        <input name="location" defaultValue={item.location ?? item.providers?.address ?? ''} placeholder="Clinic name or address" />
      </label>
      <label className="field">
        With
        <input name="provider" defaultValue={item.providers?.name ?? ''} placeholder="Doctor, clinic or lab" />
      </label>
      <label className="field">
        Prep for the day
        <span className="hint">Shows in the calendar event, so everyone sees it.</span>
        <textarea name="prep_instructions" defaultValue={item.prep_instructions ?? ''} placeholder="Fasting from midnight, bring medication list, needs a driver…" />
      </label>

      {!calendarConnected && (
        <p className="notice warn small">Google Calendar isn&rsquo;t connected, so this will be saved here only.</p>
      )}
      {state && (state.ok ? <p className="notice ok">{state.message}</p> : <p className="notice error">{state.error}</p>)}

      <button className="btn primary block" disabled={pending} style={{ minHeight: 56 }}>
        <CalendarPlus size={20} aria-hidden />
        {pending ? 'Saving…' : booked ? 'Update the calendar' : 'Add to family calendar'}
      </button>
    </form>
  )
}
