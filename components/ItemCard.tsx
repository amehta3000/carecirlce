import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { dueLabel } from '@/lib/dates'
import type { CareItem } from '@/lib/types'

export const KIND_LABEL: Record<string, string> = {
  appointment: 'Appointment',
  lab: 'Lab / blood work',
  imaging: 'Imaging',
  procedure: 'Procedure',
  referral: 'Referral',
  other: 'Other',
}

export const URGENCY_LABEL: Record<string, string> = { urgent: 'Urgent', soon: 'Soon', routine: 'Routine' }

export function ItemCard({ item, tz, updatedBy }: { item: CareItem; tz: string; updatedBy?: string }) {
  const due = dueLabel(item.due_by, item.due_hint, tz)
  const overdue = due?.startsWith('Overdue')
  return (
    <Link href={`/items/${item.id}`} className={`card ${item.urgency}`}>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow stack gap-4">
          <div className="row wrap" style={{ gap: 6 }}>
            <span className={`pill ${item.urgency}`}>{URGENCY_LABEL[item.urgency]}</span>
            <span className="tiny faint">{KIND_LABEL[item.kind]}</span>
          </div>
          <p style={{ fontWeight: 700, fontSize: 19, lineHeight: 1.3 }}>{item.title}</p>
          {item.providers?.name && <p className="muted small">{item.providers.name}</p>}
          {due && (
            <p className="small" style={{ color: overdue ? 'var(--urgent)' : 'var(--ink-2)', fontWeight: overdue ? 700 : 400 }}>
              {due}
            </p>
          )}
          {updatedBy && <p className="tiny faint">Last touched by {updatedBy}</p>}
        </div>
        <ChevronRight size={22} className="faint" aria-hidden style={{ marginTop: 4 }} />
      </div>
    </Link>
  )
}
