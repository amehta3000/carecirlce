import { getContext } from '@/lib/context'
import { createClient } from '@/lib/supabase/server'
import { MedRow, NoteRow, AddMedForm } from '@/components/MedControls'
import type { CareNote, Medication } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function Meds() {
  const ctx = await getContext()
  const supabase = await createClient()
  const [{ data: meds }, { data: notes }] = await Promise.all([
    supabase.from('medications').select('*').eq('circle_id', ctx.circle.id).order('active', { ascending: false }).order('name'),
    supabase.from('care_notes').select('*').eq('circle_id', ctx.circle.id).eq('active', true).order('created_at', { ascending: false }),
  ])
  const active = ((meds as Medication[]) || []).filter((m) => m.active)
  const past = ((meds as Medication[]) || []).filter((m) => !m.active)

  return (
    <div className="stack">
      <h1 className="display" style={{ fontSize: 32 }}>Medications</h1>
      <p className="muted small" style={{ marginTop: 4 }}>
        A running list from the papers. Always check against the pharmacy label.
      </p>

      <h2 className="section-title">Taking now ({active.length})</h2>
      {active.length === 0 ? (
        <p className="empty small">None recorded yet.</p>
      ) : (
        <div className="list">
          {active.map((m) => <MedRow key={m.id} med={m} canEdit={ctx.canEdit} />)}
        </div>
      )}

      {ctx.canEdit && (
        <details className="card" style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Add a medication by hand</summary>
          <div style={{ marginTop: 14 }}><AddMedForm /></div>
        </details>
      )}

      {(notes as CareNote[])?.length ? (
        <>
          <h2 className="section-title">Standing instructions</h2>
          <div className="list">
            {(notes as CareNote[]).map((n) => <NoteRow key={n.id} note={n} canEdit={ctx.canEdit} />)}
          </div>
        </>
      ) : null}

      {past.length > 0 && (
        <>
          <h2 className="section-title">Stopped</h2>
          <div className="list">
            {past.map((m) => <MedRow key={m.id} med={m} canEdit={ctx.canEdit} />)}
          </div>
        </>
      )}
    </div>
  )
}
