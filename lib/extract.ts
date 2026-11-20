import 'server-only'
import Anthropic from '@anthropic-ai/sdk'
import type { Extraction } from '@/lib/types'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM = `You read medical paperwork (discharge summaries, after-visit summaries, lab orders, referral slips, prescription printouts) for a family coordinating an elderly parent's care. Your job is extraction, not medical advice.

Rules:
- Only report what the paper says. Never invent a provider, date, dose or instruction.
- follow_ups: every appointment, lab draw, imaging study, procedure or referral the patient still needs to get done. One entry per distinct thing. Do NOT include the visit that produced this paper.
- due_by: an ISO date (YYYY-MM-DD) only when the paper gives a date, or gives a relative interval ("in 2 weeks", "10 days") AND the visit date is known so you can compute it. Otherwise null, and put the paper's wording in due_hint.
- urgency: "urgent" if due within ~14 days or the paper stresses it; "soon" if within ~6 weeks; otherwise "routine".
- prep_instructions: fasting, holding a medication, bringing films, arriving early, needing a driver.
- medications: every medication the paper starts, changes, stops or tells them to continue. change_type must reflect what the paper says.
- instructions: standing instructions that are not appointments or meds (activity limits, wound care, diet). Set is_warning for "call/return if..." red flags.
- source_quote: a short verbatim excerpt (under 25 words) from the paper supporting the entry, so the family can check it against the original.
- unclear: anything a family member should ask the doctor's office about because the paper is ambiguous, illegible or contradictory.
- If the pages are not medical paperwork, return empty lists and say so in summary.`

const TOOL: Anthropic.Tool = {
  name: 'record_extraction',
  description: 'Record everything actionable found in the paperwork.',
  input_schema: {
    type: 'object',
    required: ['document_title', 'provider_name', 'visit_date', 'summary', 'follow_ups', 'medications', 'instructions', 'unclear'],
    properties: {
      document_title: { type: 'string', description: 'e.g. "Discharge summary — UCLA Endoscopy"' },
      provider_name: { type: ['string', 'null'] },
      visit_date: { type: ['string', 'null'], description: 'YYYY-MM-DD' },
      summary: { type: 'string', description: 'Two or three plain-language sentences on what happened at the visit.' },
      follow_ups: {
        type: 'array',
        items: {
          type: 'object',
          required: ['kind', 'title', 'provider', 'urgency', 'due_by', 'due_hint', 'details', 'prep_instructions', 'source_quote'],
          properties: {
            kind: { type: 'string', enum: ['appointment', 'lab', 'imaging', 'procedure', 'referral', 'other'] },
            title: { type: 'string', description: 'Short, e.g. "Follow-up with Dr. Lin to review biopsy"' },
            provider: { type: ['string', 'null'] },
            urgency: { type: 'string', enum: ['urgent', 'soon', 'routine'] },
            due_by: { type: ['string', 'null'] },
            due_hint: { type: ['string', 'null'] },
            details: { type: ['string', 'null'] },
            prep_instructions: { type: ['string', 'null'] },
            source_quote: { type: ['string', 'null'] },
          },
        },
      },
      medications: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'dose', 'frequency', 'instructions', 'change_type', 'source_quote'],
          properties: {
            name: { type: 'string' },
            dose: { type: ['string', 'null'] },
            frequency: { type: ['string', 'null'] },
            instructions: { type: ['string', 'null'] },
            change_type: { type: 'string', enum: ['new', 'changed', 'stopped', 'continue'] },
            source_quote: { type: ['string', 'null'] },
          },
        },
      },
      instructions: {
        type: 'array',
        items: {
          type: 'object',
          required: ['body', 'is_warning'],
          properties: { body: { type: 'string' }, is_warning: { type: 'boolean' } },
        },
      },
      unclear: { type: 'array', items: { type: 'string' } },
    },
  },
}

export type PageInput = { mediaType: string; base64: string }

export async function extractFromPages(pages: PageInput[], todayISO: string): Promise<Extraction> {
  const content: Anthropic.ContentBlockParam[] = pages.map((p) =>
    p.mediaType === 'application/pdf'
      ? {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: p.base64 },
        }
      : {
          type: 'image',
          source: {
            type: 'base64',
            media_type: p.mediaType as 'image/jpeg' | 'image/png' | 'image/webp',
            data: p.base64,
          },
        },
  )
  content.push({
    type: 'text',
    text: `These ${pages.length} page(s) are one set of paperwork. Today is ${todayISO}. Extract everything actionable.`,
  })

  const msg = await client.messages.create({
    model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5',
    max_tokens: 4096,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: 'tool', name: TOOL.name },
    messages: [{ role: 'user', content }],
  })

  const block = msg.content.find((b) => b.type === 'tool_use')
  if (!block || block.type !== 'tool_use') throw new Error('The model did not return a structured result.')
  return block.input as Extraction
}
