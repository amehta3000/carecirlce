import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { getContext } from '@/lib/context'
import { ItemForm } from '@/components/ItemForm'

export default async function NewItem() {
  const ctx = await getContext()
  if (!ctx.canEdit) return <p className="empty">You have view-only access.</p>
  return (
    <div className="stack gap-16">
      <Link href="/" className="btn ghost sm" style={{ alignSelf: 'flex-start', paddingLeft: 0 }}>
        <ArrowLeft size={18} aria-hidden /> Today
      </Link>
      <h1 className="display" style={{ fontSize: 30 }}>Add something to book</h1>
      <div className="card">
        <ItemForm />
      </div>
    </div>
  )
}
