import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, FileText } from 'lucide-react'
import { getContext } from '@/lib/context'
import { createClient } from '@/lib/supabase/server'
import { dueLabel, fmtInTz } from '@/lib/dates'
import { isConnected } from '@/lib/google'
import { KIND_LABEL, URGENCY_LABEL } from '@/components/ItemCard'
import { ScheduleForm } from '@/components/ScheduleForm'
import { ItemForm } from '@/components/ItemForm'
import { StatusButtons } from '@/components/StatusButtons'
import type { CareItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getContext()
  const supabase = await createClient()
  const { data } = await supabase
    .from('care_items')
    .select('*, providers(*)')
    .eq('id', id)
    .eq('circle_id', ctx.circle.id)
    .maybeSingle()
  if (!data) notFound()
  const item = data as CareItem
  const tz = ctx.circle.timezone
  const connected = await isConnected(ctx.circle.id).catch(() => false)

  const { data: history } = await supabase
    .from('activity_log')
    .select('actor, action, at')
    .eq('entity_id', item.id)
    .order('at', { ascending: false })
    .limit(6)

  const who = (uid: string | null) =>
    uid === ctx.userId ? 'You' : ctx.members.find((m) => m.user_id === uid)?.display_name?.split(' ')[0] || 'Someone'
  const due = dueLabel(item.due_by, item.due_hint, tz)

  return (
    <div className="stack gap-16">
      <Link href="/" className="btn ghost sm" style={{ alignSelf: 'flex-start', paddingLeft: 0 }}>
        <ArrowLeft size={18} aria-hidden /> Today
      </Link>

      <div className="stack gap-8">
        <div className="row wrap" style={{ gap: 6 }}>
          <span className={`pill ${item.urgency}`}>{URGENCY_LABEL[item.urgency]}</span>
          <span className="pill routine">{KIND_LABEL[item.kind]}</span>
          {item.status === 'scheduled' && <span className="pill ok">Booked</span>}
          {item.status === 'done' && <span className="pill ok">Done</span>}
          {item.status === 'dismissed' && <span className="pill routine">Not needed</span>}
        </div>
        <h1 className="display" style={{ fontSize: 30, lineHeight: 1.15 }}>{item.title}</h1>
        {item.providers?.name && <p className="muted">{item.providers.name}</p>}
        {item.status === 'to_schedule' && due && <p style={{ fontWeight: 700 }}>{due}</p>}
        {item.status === 'scheduled' && item.scheduled_start && (
          <p className="notice ok" style={{ fontSize: 18 }}>
            <strong>{fmtInTz(item.scheduled_start, tz, "EEEE, MMMM d 'at' h:mm a")}</strong>
            {item.location ? <><br />{item.location}</> : null}
          </p>
        )}
      </div>

      {(item.details || item.prep_instructions || item.source_quote) && (
        <div className="card stack gap-8">
          {item.prep_instructions && <p><strong>Prep:</strong> {item.prep_instructions}</p>}
          {item.details && <p className="muted">{item.details}</p>}
          {item.source_quote && <p className="quote">&ldquo;{item.source_quote}&rdquo;</p>}
          {item.document_id && (
            <Link href={`/papers/${item.document_id}`} className="small row" style={{ gap: 6 }}>
              <FileText size={16} aria-hidden /> See the original papers
            </Link>
          )}
        </div>
      )}

      {ctx.canEdit && (item.status === 'to_schedule' || item.status === 'scheduled') && (
        <ScheduleForm item={item} tz={tz} calendarConnected={connected} />
      )}

      {ctx.canEdit && <StatusButtons itemId={item.id} status={item.status} />}

      {ctx.canEdit && (
        <details className="card">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Edit details</summary>
          <div style={{ marginTop: 14 }}>
            <ItemForm item={item} />
          </div>
        </details>
      )}

      {history && history.length > 0 && (
        <div className="stack gap-4">
          <p className="section-title" style={{ marginTop: 8 }}>History</p>
          {history.map((h, i) => (
            <p key={i} className="small muted">
              {who(h.actor)} · {h.action.replace('_', ' ')} · {fmtInTz(h.at, tz, 'MMM d, h:mm a')}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
