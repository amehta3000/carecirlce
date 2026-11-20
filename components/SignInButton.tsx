'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export function SignInButton() {
  const [busy, setBusy] = useState(false)
  const signIn = async () => {
    setBusy(true)
    const supabase = createClient()
    // Basic profile only. Calendar access is a separate, admin-only step,
    // so Dad and others never see a calendar permission screen.
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    })
  }
  return (
    <button className="btn primary block" onClick={signIn} disabled={busy} style={{ minHeight: 56 }}>
      <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
        <path fill="#fff" d="M21.35 11.1H12v2.98h5.35c-.23 1.4-1.66 4.1-5.35 4.1-3.22 0-5.85-2.67-5.85-5.96S8.78 6.26 12 6.26c1.84 0 3.07.78 3.77 1.45l2.57-2.48C16.7 3.7 14.56 2.8 12 2.8 6.98 2.8 2.9 6.9 2.9 11.92S6.98 21.04 12 21.04c6.93 0 9.2-4.86 9.2-7.36 0-.5-.05-.86-.12-1.24z" />
      </svg>
      {busy ? 'Opening Google…' : 'Continue with Google'}
    </button>
  )
}
