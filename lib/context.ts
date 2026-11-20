import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import type { Circle, Member, MemberRole } from '@/lib/types'

export type AppContext = {
  userId: string
  email: string
  name: string
  circle: Circle
  me: Member
  members: Member[]
  role: MemberRole
  canEdit: boolean
  isAdmin: boolean
}

/**
 * Loads the signed-in user's care circle. Accepts pending invites on the way.
 * Cached per request so layouts and pages can both call it.
 */
export const getContext = cache(async (): Promise<AppContext> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  let { data: memberships } = await supabase
    .from('circle_members')
    .select('*, care_circles(*)')
    .eq('user_id', user.id)
    .order('joined_at')

  if (!memberships || memberships.length === 0) {
    const { data: accepted } = await supabase.rpc('accept_my_invites')
    if (accepted && accepted > 0) {
      ;({ data: memberships } = await supabase
        .from('circle_members')
        .select('*, care_circles(*)')
        .eq('user_id', user.id)
        .order('joined_at'))
    }
  }

  if (!memberships || memberships.length === 0) redirect('/welcome')

  // One circle per family is the expected case; use the first.
  const mine = memberships[0] as Member & { care_circles: Circle }
  const circle = mine.care_circles

  const { data: members } = await supabase
    .from('circle_members')
    .select('*')
    .eq('circle_id', circle.id)
    .order('joined_at')

  return {
    userId: user.id,
    email: user.email ?? '',
    name: (user.user_metadata?.full_name as string) || user.email || 'You',
    circle,
    me: mine,
    members: (members as Member[]) ?? [],
    role: mine.role,
    canEdit: mine.role !== 'viewer',
    isAdmin: mine.role === 'admin',
  }
})

export async function requireEditor() {
  const ctx = await getContext()
  if (!ctx.canEdit) throw new Error('You have view-only access to this care circle.')
  return ctx
}

export async function requireAdmin() {
  const ctx = await getContext()
  if (!ctx.isAdmin) throw new Error('Only an admin can do that.')
  return ctx
}
