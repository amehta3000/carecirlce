import { SignInButton } from '@/components/SignInButton'

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams
  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="stack gap-24" style={{ maxWidth: 380, width: '100%' }}>
        <div className="stack gap-12">
          <img src="/icon.svg" alt="" width={56} height={56} />
          <h1 className="display" style={{ fontSize: 40, lineHeight: 1.05 }}>
            CareCircle
          </h1>
          <p className="muted">
            One place for the family to keep track of Dad&rsquo;s appointments, paperwork and medications.
          </p>
        </div>
        {error && <p className="notice error">Sign-in didn&rsquo;t complete. Please try again.</p>}
        <SignInButton />
        <p className="faint small">
          Only family members who&rsquo;ve been invited can see anything here.
        </p>
      </div>
    </main>
  )
}
