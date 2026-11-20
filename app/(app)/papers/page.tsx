import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { getContext } from '@/lib/context'
import { createClient } from '@/lib/supabase/server'
import { fmtInTz } from '@/lib/dates'
import type { DocumentRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function Papers() {
  const ctx = await getContext()
  const supabase = await createClient()
  const { data } = await supabase
    .from('documents')
    .select('id, status, title, provider_name, visit_date, created_at, confirmed_at, storage_paths')
    .eq('circle_id', ctx.circle.id)
    .order('created_at', { ascending: false })
    .limit(100)
  const docs = (data as (DocumentRow & { confirmed_at: string | null })[]) || []

  return (
    <div className="stack gap-16">
      <div className="row between">
        <h1 className="display" style={{ fontSize: 32 }}>Papers</h1>
        {ctx.canEdit && <Link href="/scan" className="btn primary sm">Scan</Link>}
      </div>
      {docs.length === 0 ? (
        <p className="empty">Nothing scanned yet.</p>
      ) : (
        <div className="list">
          {docs.map((d) => {
            const pill =
              d.status === 'failed'
                ? <span className="pill urgent">Couldn&rsquo;t read</span>
                : d.status !== 'ready'
                  ? <span className="pill routine">Reading…</span>
                  : d.confirmed_at
                    ? <span className="pill ok">Added to plan</span>
                    : <span className="pill soon">Needs review</span>
            return (
              <Link key={d.id} href={`/papers/${d.id}`} className="card">
                <div className="row">
                  <div className="grow stack gap-4">
                    <div>{pill}</div>
                    <p style={{ fontWeight: 700 }}>{d.title || 'Untitled papers'}</p>
                    <p className="muted small">
                      {[d.provider_name, d.visit_date ? `Visit ${d.visit_date}` : null, `${d.storage_paths.length} page(s)`]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                    <p className="tiny faint">Scanned {fmtInTz(d.created_at, ctx.circle.timezone, 'MMM d, yyyy')}</p>
                  </div>
                  <ChevronRight size={22} className="faint" aria-hidden />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
