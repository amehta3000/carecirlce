import Link from 'next/link'

export default function NotAllowed() {
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="stack gap-16" style={{ maxWidth: 380 }}>
        <h1 className="display" style={{ fontSize: 30 }}>This account isn&rsquo;t on the list</h1>
        <p className="muted">
          CareCircle is private to one family. If you should have access, ask whoever set it up to add
          the Google account you&rsquo;re using.
        </p>
        <Link href="/login" className="btn secondary">Try a different account</Link>
      </div>
    </main>
  )
}
