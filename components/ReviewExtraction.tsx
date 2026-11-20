'use client'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { confirmExtraction } from '@/app/actions'
import type { Extraction } from '@/lib/types'

const CHANGE_LABEL = { new: 'New', changed: 'Changed', stopped: 'Stop', continue: 'Continue' } as const
const URG = { urgent: 'Urgent', soon: 'Soon', routine: 'Routine' } as const

export function ReviewExtraction({ docId, extraction: ex }: { docId: string; extraction: Extraction }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const [f, setF] = useState(() => new Set(ex.follow_ups.map((_, i) => i)))
  const [m, setM] = useState(() => new Set(ex.medications.map((_, i) => i)))
  const [n, setN] = useState(() => new Set(ex.instructions.map((_, i) => i)))
  const [edits, setEdits] = useState<Record<string, { title?: string; due_by?: string | null }>>({})

  const toggle = (set: Set<number>, setter: (s: Set<number>) => void, i: number) => {
    const next = new Set(set)
    next.has(i) ? next.delete(i) : next.add(i)
    setter(next)
  }
  const edit = (key: string, patch: { title?: string; due_by?: string | null }) =>
    setEdits((e) => ({ ...e, [key]: { ...e[key], ...patch } }))

  const total = f.size + m.size + n.size
  const nothingFound = ex.follow_ups.length + ex.medications.length + ex.instructions.length === 0

  const submit = () =>
    start(async () => {
      setError('')
      const res = await confirmExtraction(docId, {
        followUps: [...f],
        medications: [...m],
        instructions: [...n],
        edits,
      })
      if (!res.ok) return setError(res.error)
      router.push('/')
      router.refresh()
    })

  if (nothingFound) {
    return <p className="empty">Nothing actionable was found on these pages. Check the originals above to be sure.</p>
  }

  return (
    <div className="stack gap-8">
      <p className="notice info small">
        Check each item against the paper. Untick anything that&rsquo;s wrong; you can edit titles and dates here.
      </p>

      {ex.follow_ups.length > 0 && (
        <>
          <h2 className="section-title">To book ({ex.follow_ups.length})</h2>
          <div className="list">
            {ex.follow_ups.map((item, i) => {
              const on = f.has(i)
              const e = edits[`f${i}`] || {}
              return (
                <div key={i} className={`checkrow ${on ? 'on' : ''}`}>
                  <input type="checkbox" checked={on} onChange={() => toggle(f, setF, i)} aria-label={`Include ${item.title}`} />
                  <div className="grow stack gap-8">
                    <div className="row wrap" style={{ gap: 6 }}>
                      <span className={`pill ${item.urgency}`}>{URG[item.urgency]}</span>
                      {item.provider && <span className="small muted">{item.provider}</span>}
                    </div>
                    <input
                      value={e.title ?? item.title}
                      onChange={(ev) => edit(`f${i}`, { title: ev.target.value })}
                      disabled={!on}
                      aria-label="Title"
                      style={{ fontWeight: 700 }}
                    />
                    <label className="field">
                      <span>
                        Book by{' '}
                        {item.due_hint && <span className="hint">· paper says &ldquo;{item.due_hint}&rdquo;</span>}
                      </span>
                      <input
                        type="date"
                        value={(e.due_by !== undefined ? e.due_by : item.due_by) || ''}
                        onChange={(ev) => edit(`f${i}`, { due_by: ev.target.value || null })}
                        disabled={!on}
                      />
                    </label>
                    {item.prep_instructions && <p className="small"><strong>Prep:</strong> {item.prep_instructions}</p>}
                    {item.details && <p className="small muted">{item.details}</p>}
                    {item.source_quote && <p className="quote">&ldquo;{item.source_quote}&rdquo;</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {ex.medications.length > 0 && (
        <>
          <h2 className="section-title">Medications ({ex.medications.length})</h2>
          <div className="list">
            {ex.medications.map((med, i) => (
              <label key={i} className={`checkrow ${m.has(i) ? 'on' : ''}`}>
                <input type="checkbox" checked={m.has(i)} onChange={() => toggle(m, setM, i)} />
                <div className="grow stack gap-4">
                  <div className="row wrap" style={{ gap: 6 }}>
                    <span className={`pill ${med.change_type === 'stopped' ? 'urgent' : med.change_type === 'continue' ? 'routine' : 'accent'}`}>
                      {CHANGE_LABEL[med.change_type]}
                    </span>
                    <strong>{med.name}</strong>
                  </div>
                  <p className="small">{[med.dose, med.frequency].filter(Boolean).join(' · ')}</p>
                  {med.instructions && <p className="small muted">{med.instructions}</p>}
                  {med.source_quote && <p className="quote">&ldquo;{med.source_quote}&rdquo;</p>}
                </div>
              </label>
            ))}
          </div>
        </>
      )}

      {ex.instructions.length > 0 && (
        <>
          <h2 className="section-title">Instructions ({ex.instructions.length})</h2>
          <div className="list">
            {ex.instructions.map((ins, i) => (
              <label key={i} className={`checkrow ${n.has(i) ? 'on' : ''}`}>
                <input type="checkbox" checked={n.has(i)} onChange={() => toggle(n, setN, i)} />
                <div className="grow row" style={{ alignItems: 'flex-start' }}>
                  {ins.is_warning && <AlertTriangle size={18} style={{ color: 'var(--soon)', flexShrink: 0, marginTop: 3 }} aria-label="Warning sign" />}
                  <span>{ins.body}</span>
                </div>
              </label>
            ))}
          </div>
        </>
      )}

      {error && <p className="notice error">{error}</p>}
      <div style={{ position: 'sticky', bottom: 76, paddingTop: 12 }}>
        <button className="btn primary block" style={{ minHeight: 60 }} disabled={pending || total === 0} onClick={submit}>
          {pending ? 'Adding…' : `Add ${total} to the plan`}
        </button>
      </div>
    </div>
  )
}
