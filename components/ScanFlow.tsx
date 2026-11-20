'use client'
import { useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Camera, FileUp, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { attachPages, createDocument } from '@/app/actions'

type Page = { file: File; preview: string | null }

const MAX_PAGES = 12
const MAX_EDGE = 2000 // px; keeps each page well under the API's image limit

/** Re-encode a photo as a ~2000px JPEG. Also strips EXIF (including GPS). */
async function shrinkImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process image'))), 'image/jpeg', 0.85),
  )
}

export function ScanFlow() {
  const router = useRouter()
  const cameraRef = useRef<HTMLInputElement>(null)
  const filesRef = useRef<HTMLInputElement>(null)
  const [pages, setPages] = useState<Page[]>([])
  const [stage, setStage] = useState<'pick' | 'uploading' | 'reading'>('pick')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  const add = (list: FileList | null) => {
    if (!list) return
    setError('')
    const next = Array.from(list)
      .filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf')
      .map((file) => ({ file, preview: file.type.startsWith('image/') ? URL.createObjectURL(file) : null }))
    setPages((p) => [...p, ...next].slice(0, MAX_PAGES))
  }

  const remove = (i: number) =>
    setPages((p) => {
      const pg = p[i]
      if (pg?.preview) URL.revokeObjectURL(pg.preview)
      return p.filter((_, j) => j !== i)
    })

  const submit = async () => {
    setError('')
    setStage('uploading')
    try {
      const doc = await createDocument()
      if ('error' in doc) throw new Error(doc.error)
      const supabase = createClient()
      const paths: string[] = []
      for (let i = 0; i < pages.length; i++) {
        setProgress(`Uploading page ${i + 1} of ${pages.length}…`)
        const { file } = pages[i]
        const isPdf = file.type === 'application/pdf'
        if (isPdf && file.size > 20 * 1024 * 1024) throw new Error('That PDF is over 20 MB.')
        const body = isPdf ? file : await shrinkImage(file)
        const path = `${doc.circleId}/${doc.id}/page-${i + 1}.${isPdf ? 'pdf' : 'jpg'}`
        const { error: upErr } = await supabase.storage
          .from('documents')
          .upload(path, body, { contentType: isPdf ? 'application/pdf' : 'image/jpeg', upsert: false })
        if (upErr) throw new Error(upErr.message)
        paths.push(path)
      }
      const attached = await attachPages(doc.id, paths)
      if (!attached.ok) throw new Error(attached.error)

      setStage('reading')
      setProgress('Reading the papers. This usually takes 20–40 seconds…')
      const res = await fetch(`/api/documents/${doc.id}/extract`, { method: 'POST' })
      // Even on failure the pages are saved; the review screen offers a retry.
      if (!res.ok) {
        const j = await res.json().catch(() => ({}))
        console.warn('Extraction failed', j)
      }
      router.push(`/papers/${doc.id}`)
    } catch (e) {
      setError((e as Error).message)
      setStage('pick')
    }
  }

  if (stage !== 'pick') {
    return (
      <div className="card stack gap-16" style={{ alignItems: 'center', textAlign: 'center', padding: 32 }}>
        <div className="spinner" />
        <p style={{ fontWeight: 700 }}>{progress}</p>
        <p className="muted small">Keep this screen open.</p>
      </div>
    )
  }

  return (
    <div className="stack gap-16">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => {
          add(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={filesRef}
        type="file"
        accept="image/*,application/pdf"
        multiple
        hidden
        onChange={(e) => {
          add(e.target.files)
          e.target.value = ''
        }}
      />

      <div className="grid-2">
        <button className="btn primary" style={{ minHeight: 64 }} onClick={() => cameraRef.current?.click()}>
          <Camera size={22} aria-hidden /> {pages.length ? 'Next page' : 'Take photo'}
        </button>
        <button className="btn secondary" style={{ minHeight: 64 }} onClick={() => filesRef.current?.click()}>
          <FileUp size={22} aria-hidden /> Choose files
        </button>
      </div>

      {pages.length === 0 ? (
        <div className="stack gap-8 small muted card">
          <strong style={{ color: 'var(--ink)' }}>Tips for a good read</strong>
          <span>Lay each page flat in good light, and fill the frame with the paper.</span>
          <span>One photo per page. Include the back if it has writing.</span>
          <span>PDFs from the patient portal work too.</span>
        </div>
      ) : (
        <>
          <div className="thumbs">
            {pages.map((p, i) => (
              <div key={i} style={{ position: 'relative' }}>
                {p.preview ? (
                  <img src={p.preview} alt={`Page ${i + 1}`} />
                ) : (
                  <div className="card small" style={{ aspectRatio: '3/4', display: 'grid', placeItems: 'center' }}>
                    PDF
                  </div>
                )}
                <button
                  onClick={() => remove(i)}
                  aria-label={`Remove page ${i + 1}`}
                  className="btn sm secondary"
                  style={{ position: 'absolute', top: 4, right: 4, minHeight: 32, width: 32, padding: 0, borderRadius: 999 }}
                >
                  <X size={16} aria-hidden />
                </button>
                <p className="tiny faint" style={{ textAlign: 'center', marginTop: 2 }}>Page {i + 1}</p>
              </div>
            ))}
          </div>
          <button className="btn primary block" style={{ minHeight: 60 }} onClick={submit}>
            Read {pages.length} {pages.length === 1 ? 'page' : 'pages'}
          </button>
        </>
      )}
      {error && <p className="notice error">{error}</p>}
    </div>
  )
}
