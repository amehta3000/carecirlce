'use client'
import { useActionState, useTransition } from 'react'
import { AlertTriangle } from 'lucide-react'
import { addMedication, setMedicationActive, setNoteActive, type ActionResult } from '@/app/actions'
import type { CareNote, Medication } from '@/lib/types'

export function MedRow({ med, canEdit }: { med: Medication; canEdit: boolean }) {
  const [pending, start] = useTransition()
  return (
    <div className={`card row ${med.active ? '' : 'done'}`} style={{ alignItems: 'flex-start' }}>
      <div className="grow stack gap-4">
        <div className="row wrap" style={{ gap: 6 }}>
          <strong style={{ fontSize: 19 }}>{med.name}</strong>
          {med.change_type === 'new' && med.active && <span className="pill accent">New</span>}
          {med.change_type === 'changed' && med.active && <span className="pill soon">Changed</span>}
        </div>
        {(med.dose || med.frequency) && <p>{[med.dose, med.frequency].filter(Boolean).join(' · ')}</p>}
        {med.instructions && <p className="small muted">{med.instructions}</p>}
        {!med.active && med.end_date && <p className="tiny faint">Stopped {med.end_date}</p>}
      </div>
      {canEdit && (
        <button
          className="btn sm secondary"
          disabled={pending}
          onClick={() => start(() => setMedicationActive(med.id, !med.active).then(() => {}))}
        >
          {med.active ? 'Stopped' : 'Restart'}
        </button>
      )}
    </div>
  )
}

export function NoteRow({ note, canEdit }: { note: CareNote; canEdit: boolean }) {
  const [pending, start] = useTransition()
  return (
    <div className="card row" style={{ alignItems: 'flex-start' }}>
      {note.is_warning && <AlertTriangle size={20} style={{ color: 'var(--soon)', flexShrink: 0, marginTop: 3 }} aria-label="Warning sign" />}
      <p className="grow">{note.body}</p>
      {canEdit && (
        <button className="btn sm ghost" disabled={pending} onClick={() => start(() => setNoteActive(note.id, false).then(() => {}))}>
          No longer applies
        </button>
      )}
    </div>
  )
}

export function AddMedForm() {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(addMedication, null)
  return (
    <form action={action} className="stack gap-12">
      <label className="field">Name<input name="name" required maxLength={120} /></label>
      <div className="grid-2 collapse">
        <label className="field">Dose<input name="dose" placeholder="40 mg" /></label>
        <label className="field">How often<input name="frequency" placeholder="Twice a day" /></label>
      </div>
      <label className="field">Instructions<input name="instructions" placeholder="With food" /></label>
      {state && (state.ok ? <p className="notice ok">{state.message}</p> : <p className="notice error">{state.error}</p>)}
      <button className="btn primary" disabled={pending}>{pending ? 'Adding…' : 'Add'}</button>
    </form>
  )
}
