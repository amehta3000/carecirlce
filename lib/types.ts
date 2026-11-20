export type MemberRole = 'admin' | 'editor' | 'viewer'
export type ItemKind = 'appointment' | 'lab' | 'imaging' | 'procedure' | 'referral' | 'other'
export type ItemStatus = 'to_schedule' | 'scheduled' | 'done' | 'dismissed'
export type Urgency = 'urgent' | 'soon' | 'routine'

export type Circle = {
  id: string
  name: string
  patient_name: string
  timezone: string
  created_at: string
}

export type Member = {
  circle_id: string
  user_id: string
  role: MemberRole
  email: string
  display_name: string | null
  calendar_invites: boolean
  joined_at: string
}

export type Invite = {
  id: string
  email: string
  role: MemberRole
  created_at: string
  expires_at: string
  accepted_at: string | null
}

export type Provider = {
  id: string
  name: string
  specialty: string | null
  phone: string | null
  address: string | null
}

export type CareItem = {
  id: string
  circle_id: string
  kind: ItemKind
  title: string
  status: ItemStatus
  urgency: Urgency
  provider_id: string | null
  due_by: string | null
  due_hint: string | null
  details: string | null
  prep_instructions: string | null
  source_quote: string | null
  document_id: string | null
  scheduled_start: string | null
  scheduled_end: string | null
  location: string | null
  gcal_event_id: string | null
  completed_at: string | null
  updated_by: string | null
  updated_at: string
  created_at: string
  providers?: Provider | null
}

export type Medication = {
  id: string
  name: string
  dose: string | null
  frequency: string | null
  instructions: string | null
  change_type: 'new' | 'changed' | 'stopped' | 'continue' | null
  start_date: string | null
  end_date: string | null
  active: boolean
  document_id: string | null
  updated_at: string
}

export type CareNote = {
  id: string
  body: string
  is_warning: boolean
  active: boolean
  document_id: string | null
  created_at: string
}

export type DocumentRow = {
  id: string
  storage_paths: string[]
  status: 'uploaded' | 'processing' | 'ready' | 'failed'
  title: string | null
  provider_name: string | null
  visit_date: string | null
  summary: string | null
  extraction: Extraction | null
  error: string | null
  uploaded_by: string | null
  created_at: string
}

/** What the model returns for one set of papers. */
export type Extraction = {
  document_title: string
  provider_name: string | null
  visit_date: string | null
  summary: string
  follow_ups: ExtractedFollowUp[]
  medications: ExtractedMedication[]
  instructions: ExtractedInstruction[]
  unclear: string[]
}

export type ExtractedFollowUp = {
  kind: ItemKind
  title: string
  provider: string | null
  urgency: Urgency
  due_by: string | null
  due_hint: string | null
  details: string | null
  prep_instructions: string | null
  source_quote: string | null
}

export type ExtractedMedication = {
  name: string
  dose: string | null
  frequency: string | null
  instructions: string | null
  change_type: 'new' | 'changed' | 'stopped' | 'continue'
  source_quote: string | null
}

export type ExtractedInstruction = {
  body: string
  is_warning: boolean
}

export type AgendaEvent = {
  id: string
  title: string
  start: string
  end: string | null
  allDay: boolean
  location: string | null
  htmlLink: string | null
  careItemId: string | null
}
