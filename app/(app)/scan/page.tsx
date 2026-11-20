import { getContext } from '@/lib/context'
import { ScanFlow } from '@/components/ScanFlow'

export default async function ScanPage() {
  const ctx = await getContext()
  if (!ctx.canEdit) {
    return <p className="empty">Scanning papers needs editor access. Ask an admin to change your role.</p>
  }
  return (
    <div className="stack gap-16">
      <div className="stack gap-4">
        <h1 className="display" style={{ fontSize: 32 }}>Scan papers</h1>
        <p className="muted">
          Photograph every page from the visit: discharge summary, after-visit notes, lab orders,
          prescription printouts. You&rsquo;ll review everything before it&rsquo;s added.
        </p>
      </div>
      <ScanFlow />
    </div>
  )
}
