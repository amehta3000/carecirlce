'use client'
import { useActionState } from 'react'
import { createItem, updateItem, type ActionResult } from '@/app/actions'
import type { CareItem } from '@/lib/types'

export function ItemForm({ item }: { item?: CareItem }) {
  const [state, action, pending] = useActionState<ActionResult | null, FormData>(
    item ? updateItem.bind(null, item.id) : createItem,
    null,
  )
  return (
    <form action={action} className="stack gap-16">
      <label className="field">
        What needs to happen?
        <input name="title" defaultValue={item?.title} required maxLength={200} placeholder="e.g. Follow-up with cardiology" />
      </label>
      <div className="grid-2 collapse">
        <label className="field">
          Type
          <select name="kind" defaultValue={item?.kind ?? 'appointment'}>
            <option value="appointment">Appointment</option>
            <option value="lab">Lab / blood work</option>
            <option value="imaging">Imaging</option>
            <option value="procedure">Procedure</option>
            <option value="referral">Referral</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field">
          How soon
          <select name="urgency" defaultValue={item?.urgency ?? 'routine'}>
            <option value="urgent">Urgent (within ~2 weeks)</option>
            <option value="soon">Soon (within ~6 weeks)</option>
            <option value="routine">Routine</option>
          </select>
        </label>
      </div>
      <div className="grid-2 collapse">
        <label className="field">
          With
          <input name="provider" defaultValue={item?.providers?.name ?? ''} placeholder="Doctor, clinic or lab" />
        </label>
        <label className="field">
          Book by
          <input type="date" name="due_by" defaultValue={item?.due_by ?? ''} />
        </label>
      </div>
      <label className="field">
        Prep
        <input name="prep_instructions" defaultValue={item?.prep_instructions ?? ''} placeholder="Fasting, bring films…" />
      </label>
      <label className="field">
        Notes
        <textarea name="details" defaultValue={item?.details ?? ''} />
      </label>
      {state && (state.ok ? <p className="notice ok">{state.message}</p> : <p className="notice error">{state.error}</p>)}
      <button className="btn primary block" disabled={pending}>
        {pending ? 'Saving…' : item ? 'Save changes' : 'Add to the to-book list'}
      </button>
    </form>
  )
}
