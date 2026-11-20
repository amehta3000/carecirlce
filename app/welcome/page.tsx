import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createCircle } from '@/app/actions'
import { TimezoneField } from '@/components/TimezoneField'

// Shown to a signed-in person with no care circle and no pending invite.
export default async function Welcome() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: accepted } = await supabase.rpc('accept_my_invites')
  if (accepted && accepted > 0) redirect('/')
  const { count } = await supabase
    .from('circle_members')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', user.id)
  if (count && count > 0) redirect('/')

  return (
    <main style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <div className="stack gap-24" style={{ maxWidth: 420, width: '100%' }}>
        <div className="stack gap-8">
          <h1 className="display" style={{ fontSize: 34 }}>Set up your care circle</h1>
          <p className="muted">
            If someone in your family already set this up, ask them to invite <strong>{user.email}</strong>{' '}
            and then reload. Otherwise, start one here.
          </p>
        </div>
        <form action={createCircle} className="card stack gap-16">
          <label className="field">
            Who are you caring for?
            <input name="patient_name" placeholder="e.g. Dad, or Raj" required maxLength={80} />
          </label>
          <TimezoneField />
          <button className="btn primary block">Create care circle</button>
        </form>
        <form action="/auth/signout" method="post">
          <button className="btn ghost block">Sign out</button>
        </form>
      </div>
    </main>
  )
}
