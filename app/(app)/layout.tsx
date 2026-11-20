import Link from 'next/link'
import { getContext } from '@/lib/context'
import { Nav } from '@/components/Nav'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext()
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="brand">
            {ctx.circle.patient_name}
            <small>CareCircle</small>
          </Link>
          <Nav variant="top" />
        </div>
      </header>
      <main className="page">
        {!ctx.canEdit && (
          <p className="notice info small" style={{ marginBottom: 16 }}>
            You have view-only access. Ask an admin if you need to make changes.
          </p>
        )}
        {children}
      </main>
      <Nav variant="tabs" />
    </div>
  )
}
