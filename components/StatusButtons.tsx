'use client'
import { useState, useTransition } from 'react'
import { Check, RotateCcw, X } from 'lucide-react'
import { setItemStatus } from '@/app/actions'
import type { ItemStatus } from '@/lib/types'

export function StatusButtons({ itemId, status }: { itemId: string; status: ItemStatus }) {
  const [pending, start] = useTransition()
  const [error, setError] = useState('')
  const run = (s: 'done' | 'dismissed' | 'to_schedule', confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return
    start(async () => {
      setError('')
      const res = await setItemStatus(itemId, s)
      if (!res.ok) setError(res.error)
    })
  }

  return (
    <div className="stack gap-8">
      <div className="row wrap">
        {status === 'scheduled' && (
          <button className="btn secondary" disabled={pending} onClick={() => run('done')}>
            <Check size={18} aria-hidden /> It happened
          </button>
        )}
        {status === 'scheduled' && (
          <button
            className="btn ghost"
            disabled={pending}
            onClick={() => run('to_schedule', 'Cancel this booking? It will be removed from everyone’s calendar and go back on the to-book list.')}
          >
            <RotateCcw size={18} aria-hidden /> Cancelled, needs rebooking
          </button>
        )}
        {status === 'to_schedule' && (
          <button
            className="btn ghost"
            disabled={pending}
            onClick={() => run('dismissed', 'Mark as not needed? It will leave the to-book list.')}
          >
            <X size={18} aria-hidden /> Not needed
          </button>
        )}
        {(status === 'done' || status === 'dismissed') && (
          <button className="btn secondary" disabled={pending} onClick={() => run('to_schedule')}>
            <RotateCcw size={18} aria-hidden /> Put back on the to-book list
          </button>
        )}
      </div>
      {error && <p className="notice error small">{error}</p>}
    </div>
  )
}
