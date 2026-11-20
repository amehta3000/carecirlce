import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getContext } from '@/lib/context'
import { createClient } from '@/lib/supabase/server'
import { ReviewExtraction } from '@/components/ReviewExtraction'
import { RetryRead } from '@/components/RetryRead'
import type { CareItem, DocumentRow } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function PaperDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ctx = await getContext()
  const supabase = await createClient()
  const { data } = await supabase
    .from('documents')
    .select('*')
    .eq('id', id)
    .eq('circle_id', ctx.circle.id)
    .maybeSingle()
  if (!data) notFound()
  const doc = data as DocumentRow & { confirmed_at: string | null }

  // Short-lived signed links to the original pages (bucket is private).
  const urls = await Promise.all(
    doc.storage_paths.map(async (p) => {
      const { data } = await supabase.storage.from('documents').createSignedUrl(p, 600)
      return { path: p, url: data?.signedUrl ?? null, pdf: p.endsWith('.pdf') }
    }),
  )

  let added: CareItem[] = []
  if (doc.confirmed_at) {
    const { data: items } = await supabase.from('care_items').select('*').eq('document_id', doc.id)
    added = (items as CareItem[]) || []
  }

  return (
    <div className="stack gap-16">
      <Link href="/papers" className="btn ghost sm" style={{ alignSelf: 'flex-start', paddingLeft: 0 }}>
        <ArrowLeft size={18} aria-hidden /> Papers
      </Link>

      <div className="stack gap-4">
        <h1 className="display" style={{ fontSize: 28, lineHeight: 1.15 }}>{doc.title || 'Scanned papers'}</h1>
        <p className="muted small">
          {[doc.provider_name, doc.visit_date ? `Visit ${doc.visit_date}` : null].filter(Boolean).join(' · ')}
        </p>
      </div>

      <details className="card">
        <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Original pages ({urls.length})</summary>
        <div className="thumbs" style={{ marginTop: 12 }}>
          {urls.map((u, i) =>
            u.url ? (
              <a key={u.path} href={u.url} target="_blank" rel="noreferrer">
                {u.pdf ? (
                  <div className="card small" style={{ aspectRatio: '3/4', display: 'grid', placeItems: 'center' }}>PDF</div>
                ) : (
                  <img src={u.url} alt={`Page ${i + 1}`} />
                )}
              </a>
            ) : null,
          )}
        </div>
      </details>

      {doc.status === 'failed' && (
        <div className="notice error stack gap-8">
          <span>We couldn&rsquo;t read these pages. {doc.error}</span>
          {ctx.canEdit && <RetryRead docId={doc.id} />}
        </div>
      )}
      {(doc.status === 'uploaded' || doc.status === 'processing') && (
        <div className="notice info stack gap-8">
          <span>Still reading these pages.</span>
          {ctx.canEdit && <RetryRead docId={doc.id} label="Read now" />}
        </div>
      )}

      {doc.summary && (
        <div className="card stack gap-8">
          <p className="section-title" style={{ margin: 0 }}>What happened</p>
          <p>{doc.summary}</p>
        </div>
      )}

      {doc.status === 'ready' && doc.extraction && !doc.confirmed_at && ctx.canEdit && (
        <ReviewExtraction docId={doc.id} extraction={doc.extraction} />
      )}

      {doc.confirmed_at && (
        <div className="stack gap-8">
          <p className="notice ok">These papers have been added to the plan.</p>
          {added.length > 0 && (
            <div className="list">
              {added.map((i) => (
                <Link key={i.id} href={`/items/${i.id}`} className="card row between">
                  <span>{i.title}</span>
                  <span className={`pill ${i.status === 'to_schedule' ? 'soon' : 'ok'}`}>
                    {i.status === 'to_schedule' ? 'To book' : i.status === 'scheduled' ? 'Booked' : i.status}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}

      {doc.extraction?.unclear?.length ? (
        <div className="notice warn stack gap-8">
          <strong>Worth asking the doctor&rsquo;s office</strong>
          <ul style={{ margin: 0, paddingLeft: 22 }}>
            {doc.extraction.unclear.map((u, i) => <li key={i}>{u}</li>)}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
