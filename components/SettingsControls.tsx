'use client'
import { useActionState, useState, useTransition } from 'react'
import {
  changeRole,
  disconnectCalendar,
  inviteMember,
  removeMember,
  revokeInvite,
  setMyCalendarInvites,
  type ActionResult,
} from '@/app/actions'
import type { Invite, Member, MemberRole } from '@/lib/types'

const ROLE_LABEL: Record<MemberRole, string> = { admin: 'Admin', editor: 'Editor', viewer: 'Viewer' }

export function InviteForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(inviteMember, null)
  return (
    <form action={action} className="stack gap-12">
      <label className="field">
        Their Google email
        <span className="hint">They join by signing in with exactly this account.</span>
        <input type="email" name="email" required autoComplete="off" placeholder="brother@gmail.com" />
      </label>
      <label className="field">
        Access
        <select name="role" defaultValue="editor">
          <option value="editor">Editor: can scan and book</option>
          <option value="viewer">Viewer: can only look</option>
          <option value="admin">Admin: can also manage people</option>
        </select>
      </label>
      {state && (state.ok ? <p className="notice ok small">{state.message}</p> : <p className="notice error small">{state.error}</p>)}
      <button className="btn primary" disabled={pending}>{pending ? 'Inviting…' : 'Invite'}</button>
    </form>
  )
}

export function MemberRow({ member, isMe, canManage }: { member: Member; isMe: boolean; canManage: boolean }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const run = (fn: () => Promise<ActionResult>) =>
    start(async () => {
      setError('')
      const r = await fn()
      if (!r.ok) setError(r.error)
    })

  return (
    <div className="card stack gap-8">
      <div className="row between wrap">
        <div className="stack">
          <strong>{member.display_name || member.email}{isMe ? ' (you)' : ''}</strong>
          <span className="small muted">{member.email}</span>
        </div>
        {canManage && !isMe ? (
          <select
            value={member.role}
            disabled={pending}
            onChange={(e) => run(() => changeRole(member.user_id, e.target.value as MemberRole))}
            style={{ width: 'auto' }}
            aria-label={`Access for ${member.email}`}
          >
            <option value="admin">Admin</option>
            <option value="editor">Editor</option>
            <option value="viewer">Viewer</option>
          </select>
        ) : (
          <span className="pill routine">{ROLE_LABEL[member.role]}</span>
        )}
      </div>
      {!member.calendar_invites && <span className="tiny faint">Not receiving calendar invites</span>}
      {canManage && !isMe && (
        <button
          className="btn danger sm"
          style={{ alignSelf: 'flex-start' }}
          disabled={pending}
          onClick={() => window.confirm(`Remove ${member.email} from the care circle?`) && run(() => removeMember(member.user_id))}
        >
          Remove
        </button>
      )}
      {error && <p className="notice error small">{error}</p>}
    </div>
  )
}

export function InviteRow({ invite }: { invite: Invite }) {
  const [pending, start] = useTransition()
  const expired = new Date(invite.expires_at) < new Date()
  return (
    <div className="card row between wrap" style={{ borderStyle: 'dashed' }}>
      <div className="stack">
        <strong>{invite.email}</strong>
        <span className="small muted">
          {expired ? 'Invite expired' : 'Invited, hasn’t signed in yet'} · {ROLE_LABEL[invite.role]}
        </span>
      </div>
      <button className="btn ghost sm" disabled={pending} onClick={() => start(() => revokeInvite(invite.id).then(() => {}))}>
        Cancel invite
      </button>
    </div>
  )
}

export function CalendarToggle({ on }: { on: boolean }) {
  const [pending, start] = useTransition()
  const [value, setValue] = useState(on)
  return (
    <label className="row" style={{ cursor: 'pointer', paddingTop: 8, borderTop: '1px solid var(--line)' }}>
      <input
        type="checkbox"
        checked={value}
        disabled={pending}
        style={{ width: 24, height: 24, minHeight: 0, accentColor: 'var(--accent)' }}
        onChange={(e) => {
          const next = e.target.checked
          setValue(next)
          start(async () => {
            const r = await setMyCalendarInvites(next)
            if (!r.ok) setValue(!next)
          })
        }}
      />
      <span className="small">Add appointments to <strong>my</strong> Google Calendar (applies to new bookings)</span>
    </label>
  )
}

export function DisconnectCalendar() {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState('')
  return (
    <>
      <button
        className="btn danger sm"
        disabled={pending}
        onClick={() =>
          window.confirm('Disconnect Google Calendar? Existing events stay in Google; new bookings won’t sync.') &&
          start(async () => {
            const r = await disconnectCalendar()
            setMsg(r.ok ? r.message || '' : r.error)
          })
        }
      >
        Disconnect
      </button>
      {msg && <span className="small">{msg}</span>}
    </>
  )
}
