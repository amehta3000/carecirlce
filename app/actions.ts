'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { getContext, requireAdmin, requireEditor } from '@/lib/context'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { CalendarNotConnected, deleteEvent, upsertEvent } from '@/lib/google'
import { addLocalMinutes, localToUtcISO } from '@/lib/dates'
import type { CareItem, Extraction } from '@/lib/types'

export type ActionResult = { ok: true; message?: string } | { ok: false; error: string }

const fail = (e: unknown): ActionResult => ({
  ok: false,
  error: e instanceof z.ZodError ? e.issues[0]?.message || 'Check the form' : (e as Error).message,
})

const opt = z
  .string()
  .trim()
  .max(2000)
  .optional()
  .transform((v) => (v ? v : null))
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .optional()
  .or(z.literal(''))
  .transform((v) => (v ? v : null))

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------
export async function createCircle(formData: FormData) {
  const input = z
    .object({
      patient_name: z.string().trim().min(1, 'Who are you caring for?').max(80),
      timezone: z.string().trim().max(64),
    })
    .parse(Object.fromEntries(formData))
  const supabase = await createClient()
  const { error } = await supabase.rpc('create_circle', {
    p_name: `${input.patient_name}'s care`,
    p_patient_name: input.patient_name,
    p_timezone: input.timezone || 'America/Los_Angeles',
  })
  if (error) throw new Error(error.message)
  redirect('/settings?welcome=1')
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------
async function providerIdFor(circleId: string, name: string | null) {
  if (!name) return null
  const supabase = await createClient()
  const clean = name.trim().slice(0, 120)
  const { data: found } = await supabase
    .from('providers')
    .select('id')
    .eq('circle_id', circleId)
    .ilike('name', clean)
    .maybeSingle()
  if (found) return found.id as string
  const { data, error } = await supabase
    .from('providers')
    .insert({ circle_id: circleId, name: clean })
    .select('id')
    .single()
  if (error) throw new Error(error.message)
  return data.id as string
}

// ---------------------------------------------------------------------------
// Care items
// ---------------------------------------------------------------------------
const itemSchema = z.object({
  title: z.string().trim().min(1, 'Give it a short title').max(200),
  kind: z.enum(['appointment', 'lab', 'imaging', 'procedure', 'referral', 'other']),
  urgency: z.enum(['urgent', 'soon', 'routine']),
  provider: opt,
  due_by: isoDate,
  details: opt,
  prep_instructions: opt,
})

export async function createItem(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  let newId: string
  try {
    const ctx = await requireEditor()
    const input = itemSchema.parse(Object.fromEntries(formData))
    const supabase = await createClient()
    const provider_id = await providerIdFor(ctx.circle.id, input.provider)
    const { data, error } = await supabase
      .from('care_items')
      .insert({
        circle_id: ctx.circle.id,
        title: input.title,
        kind: input.kind,
        urgency: input.urgency,
        provider_id,
        due_by: input.due_by,
        details: input.details,
        prep_instructions: input.prep_instructions,
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    newId = data.id
  } catch (e) {
    return fail(e)
  }
  revalidatePath('/')
  redirect(`/items/${newId}`)
}

export async function updateItem(itemId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireEditor()
    const input = itemSchema.parse(Object.fromEntries(formData))
    const supabase = await createClient()
    const provider_id = await providerIdFor(ctx.circle.id, input.provider)
    const { error } = await supabase
      .from('care_items')
      .update({
        title: input.title,
        kind: input.kind,
        urgency: input.urgency,
        provider_id,
        due_by: input.due_by,
        details: input.details,
        prep_instructions: input.prep_instructions,
      })
      .eq('id', itemId)
      .eq('circle_id', ctx.circle.id)
    if (error) throw new Error(error.message)
  } catch (e) {
    return fail(e)
  }
  revalidatePath(`/items/${itemId}`)
  revalidatePath('/')
  return { ok: true, message: 'Saved' }
}

async function loadItem(itemId: string, circleId: string) {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('care_items')
    .select('*, providers(*)')
    .eq('id', itemId)
    .eq('circle_id', circleId)
    .single()
  if (error || !data) throw new Error('That item no longer exists.')
  return data as CareItem
}

function eventDescription(item: CareItem, prep: string | null, patient: string) {
  const lines = [
    `For ${patient}.`,
    item.providers?.name ? `Provider: ${item.providers.name}` : null,
    item.details ? `\n${item.details}` : null,
    prep ? `\nPREP: ${prep}` : null,
    `\nManage in CareCircle: ${process.env.APP_URL}/items/${item.id}`,
  ]
  return lines.filter(Boolean).join('\n')
}

const scheduleSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date'),
  time: z.string().regex(/^\d{2}:\d{2}$/, 'Pick a time'),
  duration: z.coerce.number().int().min(15).max(600),
  location: opt,
  provider: opt,
  prep_instructions: opt,
})

export async function scheduleItem(itemId: string, _: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireEditor()
    const input = scheduleSchema.parse(Object.fromEntries(formData))
    const item = await loadItem(itemId, ctx.circle.id)
    const supabase = await createClient()
    const provider_id = input.provider ? await providerIdFor(ctx.circle.id, input.provider) : item.provider_id

    const startLocal = `${input.date}T${input.time}`
    const endLocal = addLocalMinutes(startLocal, input.duration)
    const tz = ctx.circle.timezone

    let eventId = item.gcal_event_id
    let calendarNote: string | undefined
    try {
      eventId = await upsertEvent(ctx.circle.id, item.gcal_event_id, {
        title: `${ctx.circle.patient_name}: ${item.title}`,
        startLocal,
        endLocal,
        timezone: tz,
        location: input.location,
        description: eventDescription({ ...item, provider_id } as CareItem, input.prep_instructions, ctx.circle.patient_name),
        careItemId: item.id,
        attendees: ctx.members,
      })
    } catch (err) {
      if (err instanceof CalendarNotConnected) {
        calendarNote = 'Saved here, but Google Calendar isn’t connected yet, so nobody got an invite.'
      } else {
        throw err
      }
    }

    const { error } = await supabase
      .from('care_items')
      .update({
        status: 'scheduled',
        scheduled_start: localToUtcISO(input.date, input.time, tz),
        scheduled_end: localToUtcISO(endLocal.slice(0, 10), endLocal.slice(11), tz),
        location: input.location,
        provider_id,
        prep_instructions: input.prep_instructions,
        gcal_event_id: eventId,
      })
      .eq('id', itemId)
      .eq('circle_id', ctx.circle.id)
    if (error) throw new Error(error.message)

    revalidatePath('/')
    revalidatePath(`/items/${itemId}`)
    return { ok: true, message: calendarNote ?? 'Scheduled and added to the family calendar' }
  } catch (e) {
    return fail(e)
  }
}

export async function setItemStatus(itemId: string, status: 'done' | 'dismissed' | 'to_schedule'): Promise<ActionResult> {
  try {
    const ctx = await requireEditor()
    const item = await loadItem(itemId, ctx.circle.id)
    const supabase = await createClient()

    // Re-opening or dismissing removes the calendar event. Marking done keeps
    // it, since it's now a record of something that happened.
    const dropEvent = status !== 'done' && item.gcal_event_id
    if (dropEvent) await deleteEvent(ctx.circle.id, item.gcal_event_id!)

    const { error } = await supabase
      .from('care_items')
      .update({
        status,
        ...(dropEvent ? { gcal_event_id: null, scheduled_start: null, scheduled_end: null } : {}),
      })
      .eq('id', itemId)
      .eq('circle_id', ctx.circle.id)
    if (error) throw new Error(error.message)
    revalidatePath('/')
    revalidatePath(`/items/${itemId}`)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
export async function createDocument(): Promise<{ id: string; circleId: string } | { error: string }> {
  try {
    const ctx = await requireEditor()
    const supabase = await createClient()
    const { data, error } = await supabase
      .from('documents')
      .insert({ circle_id: ctx.circle.id, uploaded_by: ctx.userId })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    return { id: data.id, circleId: ctx.circle.id }
  } catch (e) {
    return { error: (e as Error).message }
  }
}

export async function attachPages(docId: string, paths: string[]): Promise<ActionResult> {
  try {
    const ctx = await requireEditor()
    const prefix = `${ctx.circle.id}/${docId}/`
    if (paths.length === 0 || paths.length > 12 || paths.some((p) => !p.startsWith(prefix) || p.includes('..'))) {
      throw new Error('Unexpected file paths')
    }
    const supabase = await createClient()
    const { error } = await supabase
      .from('documents')
      .update({ storage_paths: paths })
      .eq('id', docId)
      .eq('circle_id', ctx.circle.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

const confirmSchema = z.object({
  followUps: z.array(z.number().int().min(0)),
  medications: z.array(z.number().int().min(0)),
  instructions: z.array(z.number().int().min(0)),
  edits: z.record(z.string(), z.object({ title: z.string().max(200).optional(), due_by: z.string().nullable().optional() })),
})

/** Turn the reviewed extraction into care-plan rows. */
export async function confirmExtraction(docId: string, selection: z.infer<typeof confirmSchema>): Promise<ActionResult> {
  try {
    const ctx = await requireEditor()
    const sel = confirmSchema.parse(selection)
    const supabase = await createClient()
    const { data: doc } = await supabase
      .from('documents')
      .select('id, extraction, confirmed_at')
      .eq('id', docId)
      .eq('circle_id', ctx.circle.id)
      .single()
    const ex = doc?.extraction as Extraction | null
    if (!ex) throw new Error('Nothing to confirm yet.')
    if (doc?.confirmed_at) throw new Error('These papers were already added to the plan.')

    const items = sel.followUps
      .filter((i) => ex.follow_ups[i])
      .map((i) => {
        const f = ex.follow_ups[i]
        const edit = sel.edits[`f${i}`] || {}
        const due = edit.due_by !== undefined ? edit.due_by : f.due_by
        return {
          ...f,
          title: (edit.title?.trim() || f.title).slice(0, 200),
          due_by: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
        }
      })
    const meds = sel.medications.filter((i) => ex.medications[i]).map((i) => ex.medications[i])
    const notes = sel.instructions.filter((i) => ex.instructions[i]).map((i) => ex.instructions[i])

    const { error } = await supabase.rpc('confirm_document', {
      p_doc: docId,
      p_items: items,
      p_meds: meds,
      p_notes: notes,
    })
    if (error) {
      throw new Error(error.message.includes('already_confirmed') ? 'These papers were already added to the plan.' : error.message)
    }

    revalidatePath('/')
    revalidatePath('/meds')
    revalidatePath(`/papers/${docId}`)
    return { ok: true, message: `Added ${items.length} to book, ${meds.length} medications, ${notes.length} notes` }
  } catch (e) {
    return fail(e)
  }
}

// ---------------------------------------------------------------------------
// Medications & notes
// ---------------------------------------------------------------------------
export async function setMedicationActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    const ctx = await requireEditor()
    const supabase = await createClient()
    const { error } = await supabase
      .from('medications')
      .update({ active, end_date: active ? null : new Date().toISOString().slice(0, 10) })
      .eq('id', id)
      .eq('circle_id', ctx.circle.id)
    if (error) throw new Error(error.message)
    revalidatePath('/meds')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function addMedication(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireEditor()
    const input = z
      .object({ name: z.string().trim().min(1, 'Medication name').max(120), dose: opt, frequency: opt, instructions: opt })
      .parse(Object.fromEntries(formData))
    const supabase = await createClient()
    const { error } = await supabase.from('medications').insert({ circle_id: ctx.circle.id, ...input, change_type: 'new' })
    if (error) throw new Error(error.message)
    revalidatePath('/meds')
    return { ok: true, message: 'Added' }
  } catch (e) {
    return fail(e)
  }
}

export async function setNoteActive(id: string, active: boolean): Promise<ActionResult> {
  try {
    const ctx = await requireEditor()
    const supabase = await createClient()
    const { error } = await supabase.from('care_notes').update({ active }).eq('id', id).eq('circle_id', ctx.circle.id)
    if (error) throw new Error(error.message)
    revalidatePath('/meds')
    revalidatePath('/')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

// ---------------------------------------------------------------------------
// Care circle settings
// ---------------------------------------------------------------------------
export async function inviteMember(_: ActionResult | null, formData: FormData): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin()
    const input = z
      .object({
        email: z.string().trim().toLowerCase().email('Enter their Google email'),
        role: z.enum(['admin', 'editor', 'viewer']),
      })
      .parse(Object.fromEntries(formData))
    if (ctx.members.some((m) => m.email.toLowerCase() === input.email)) {
      throw new Error('They’re already in the circle.')
    }
    const supabase = await createClient()
    const { error } = await supabase.from('circle_invites').upsert(
      {
        circle_id: ctx.circle.id,
        email: input.email,
        role: input.role,
        invited_by: ctx.userId,
        expires_at: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        accepted_at: null,
      },
      { onConflict: 'circle_id,email' },
    )
    if (error) throw new Error(error.message)
    revalidatePath('/settings')
    return {
      ok: true,
      message: `Invite ready. Send ${input.email} the link to this app; they join by signing in with that Google account.`,
    }
  } catch (e) {
    return fail(e)
  }
}

export async function revokeInvite(id: string): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin()
    const supabase = await createClient()
    await supabase.from('circle_invites').delete().eq('id', id).eq('circle_id', ctx.circle.id)
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function changeRole(userId: string, role: 'admin' | 'editor' | 'viewer'): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin()
    const supabase = await createClient()
    const { error } = await supabase
      .from('circle_members')
      .update({ role })
      .eq('circle_id', ctx.circle.id)
      .eq('user_id', userId)
    if (error) throw new Error(error.message.includes('at least one admin') ? 'The circle needs at least one admin.' : error.message)
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function removeMember(userId: string): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin()
    const supabase = await createClient()
    const { error } = await supabase
      .from('circle_members')
      .delete()
      .eq('circle_id', ctx.circle.id)
      .eq('user_id', userId)
    if (error) throw new Error(error.message.includes('at least one admin') ? 'The circle needs at least one admin.' : error.message)
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function setMyCalendarInvites(on: boolean): Promise<ActionResult> {
  try {
    const ctx = await getContext()
    const supabase = await createClient()
    const { error } = await supabase.rpc('set_my_calendar_invites', { c: ctx.circle.id, on_off: on })
    if (error) throw new Error(error.message)
    revalidatePath('/settings')
    return { ok: true }
  } catch (e) {
    return fail(e)
  }
}

export async function disconnectCalendar(): Promise<ActionResult> {
  try {
    const ctx = await requireAdmin()
    // Token table is service-role only; admin role was just verified above.
    const admin = createServiceClient()
    const { data: conn } = await admin
      .from('google_connections')
      .select('refresh_token_enc')
      .eq('circle_id', ctx.circle.id)
      .maybeSingle()
    if (conn) {
      // Revoke at Google too, so the stored token is dead even if a copy leaked.
      const { decrypt } = await import('@/lib/crypto')
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token: decrypt(conn.refresh_token_enc) }),
      }).catch(() => {})
    }
    await admin.from('google_connections').delete().eq('circle_id', ctx.circle.id)
    revalidatePath('/settings')
    return { ok: true, message: 'Disconnected. The calendar itself stays in Google; you can delete it there.' }
  } catch (e) {
    return fail(e)
  }
}
