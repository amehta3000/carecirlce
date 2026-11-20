import { NextResponse } from 'next/server'
import { formatInTimeZone } from 'date-fns-tz'
import { requireEditor } from '@/lib/context'
import { createClient } from '@/lib/supabase/server'
import { extractFromPages } from '@/lib/extract'

export const maxDuration = 120

// Reads the uploaded pages (through RLS, as the signed-in user) and runs
// extraction. Results are stored on the document for review; nothing is
// added to the care plan until a family member confirms it.
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  let ctx
  try {
    ctx = await requireEditor()
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
  const supabase = await createClient()

  const { data: doc } = await supabase
    .from('documents')
    .select('id, circle_id, storage_paths, status')
    .eq('id', id)
    .eq('circle_id', ctx.circle.id)
    .maybeSingle()
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (doc.status === 'processing') return NextResponse.json({ error: 'Already processing' }, { status: 409 })

  await supabase.from('documents').update({ status: 'processing', error: null }).eq('id', id)

  try {
    const pages = await Promise.all(
      (doc.storage_paths as string[]).map(async (path) => {
        const { data, error } = await supabase.storage.from('documents').download(path)
        if (error || !data) throw new Error(`Could not read ${path}`)
        const buf = Buffer.from(await data.arrayBuffer())
        return { mediaType: data.type || 'image/jpeg', base64: buf.toString('base64') }
      }),
    )
    const today = formatInTimeZone(new Date(), ctx.circle.timezone, 'yyyy-MM-dd')
    const extraction = await extractFromPages(pages, today)

    await supabase
      .from('documents')
      .update({
        status: 'ready',
        extraction,
        title: extraction.document_title,
        provider_name: extraction.provider_name,
        visit_date: /^\d{4}-\d{2}-\d{2}$/.test(extraction.visit_date || '') ? extraction.visit_date : null,
        summary: extraction.summary,
      })
      .eq('id', id)

    return NextResponse.json({ ok: true })
  } catch (e) {
    const message = (e as Error).message || 'Reading the papers failed'
    await supabase.from('documents').update({ status: 'failed', error: message }).eq('id', id)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
