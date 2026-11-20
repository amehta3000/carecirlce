'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export function RetryRead({ docId, label = 'Try again' }: { docId: string; label?: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  return (
    <div className="row wrap">
      <button
        className="btn secondary sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setErr('')
          const res = await fetch(`/api/documents/${docId}/extract`, { method: 'POST' })
          if (!res.ok) setErr((await res.json().catch(() => ({}))).error || 'Failed again')
          setBusy(false)
          router.refresh()
        }}
      >
        {busy ? 'Reading…' : label}
      </button>
      {err && <span className="small">{err}</span>}
    </div>
  )
}
