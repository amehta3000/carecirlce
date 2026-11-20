import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'fs'

const migration = readFileSync(process.argv[2], 'utf8').replace(/create extension if not exists pgcrypto;/, '')
const db = new PGlite()

// --- Minimal Supabase stand-ins -------------------------------------------
await db.exec(`
create schema auth;
create table auth.users (id uuid primary key);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create function auth.jwt() returns jsonb language sql stable as
  $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create role authenticated nologin;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
alter table storage.objects enable row level security;
`)

await db.exec(migration)
await db.exec(`
grant usage on schema public, auth, storage to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select, insert, update, delete on storage.objects to authenticated;
grant usage on all sequences in schema public to authenticated;
`)

const U = {
  ameet: '11111111-1111-1111-1111-111111111111',
  brother: '22222222-2222-2222-2222-222222222222',
  dad: '33333333-3333-3333-3333-333333333333',
  stranger: '44444444-4444-4444-4444-444444444444',
}
const EMAIL = { ameet: 'ameet@gmail.com', brother: 'bro@gmail.com', dad: 'dad@gmail.com', stranger: 'x@gmail.com' }
for (const id of Object.values(U)) await db.query('insert into auth.users values ($1)', [id])

let pass = 0, failN = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✓', name) } else { failN++; console.log('  ✗', name, extra) }
}

async function as(who, fn) {
  const claims = JSON.stringify({ sub: U[who], email: EMAIL[who], user_metadata: { full_name: who, email_verified: true } })
  await db.exec('reset role')
  await db.query(`select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)`, [U[who], claims])
  await db.exec('set role authenticated')
  try { return await fn() } finally { await db.exec('reset role') }
}
async function throws(fn) { try { await fn(); return false } catch (e) { return e.message } }

console.log('Circle creation')
const circleId = await as('ameet', async () =>
  (await db.query(`select create_circle('Dad care','Dad','America/Los_Angeles') as id`)).rows[0].id)
ok('ameet created a circle', !!circleId)
const role = await as('ameet', async () => (await db.query('select role from circle_members where user_id=$1', [U.ameet])).rows[0]?.role)
ok('ameet is admin', role === 'admin')

console.log('Invites')
await as('ameet', () => db.query(`insert into circle_invites (circle_id,email,role,invited_by) values ($1,'bro@gmail.com','editor',$2),($1,'dad@gmail.com','viewer',$2)`, [circleId, U.ameet]))
ok('stranger cannot see invites', (await as('stranger', () => db.query('select * from circle_invites'))).rows.length === 0)
ok('stranger cannot invite', !!(await throws(() => as('stranger', () => db.query(`insert into circle_invites (circle_id,email,role,invited_by) values ($1,'evil@x.com','admin',$2)`, [circleId, U.stranger])))))
ok('stranger accepts nothing', (await as('stranger', () => db.query('select accept_my_invites() n'))).rows[0].n === 0)
ok('brother accepts invite', (await as('brother', () => db.query('select accept_my_invites() n'))).rows[0].n === 1)
ok('dad accepts invite', (await as('dad', () => db.query('select accept_my_invites() n'))).rows[0].n === 1)
ok('brother cannot read pending invites (not admin)', (await as('brother', () => db.query('select * from circle_invites'))).rows.length === 0)

console.log('Care items')
await as('brother', () => db.query(`insert into care_items (circle_id,title,urgency) values ($1,'CBC blood panel','urgent')`, [circleId]))
const item = (await as('ameet', () => db.query('select * from care_items'))).rows[0]
ok('brother (editor) can add item', !!item)
ok('trigger stamps updated_by', item?.updated_by === U.brother)
ok('dad (viewer) can read items', (await as('dad', () => db.query('select * from care_items'))).rows.length === 1)
ok('dad (viewer) cannot add items', !!(await throws(() => as('dad', () => db.query(`insert into care_items (circle_id,title) values ($1,'x')`, [circleId])))))
const dadUpd = await as('dad', () => db.query(`update care_items set title='hacked'`))
ok('dad (viewer) cannot edit items', dadUpd.affectedRows === 0)
ok('stranger sees no items', (await as('stranger', () => db.query('select * from care_items'))).rows.length === 0)
ok('stranger cannot insert into circle', !!(await throws(() => as('stranger', () => db.query(`insert into care_items (circle_id,title) values ($1,'x')`, [circleId])))))
ok('brother cannot delete (admin only)', (await as('brother', () => db.query('delete from care_items'))).affectedRows === 0)
const log = (await as('dad', () => db.query('select * from activity_log where entity=$1', ['care_item']))).rows
ok('activity log readable by members', log.length >= 1)
ok('nobody can write activity log directly', !!(await throws(() => as('ameet', () => db.query(`insert into activity_log (circle_id,action,entity) values ($1,'fake','x')`, [circleId])))))

console.log('Roles')
const selfPromote = await as('dad', () => db.query(`update circle_members set role='admin' where user_id=$1`, [U.dad]))
ok('dad cannot promote himself', selfPromote.affectedRows === 0)
await as('dad', () => db.query(`select set_my_calendar_invites($1,false)`, [circleId]))
const dadRow = (await as('ameet', () => db.query('select role, calendar_invites from circle_members where user_id=$1', [U.dad]))).rows[0]
ok('dad can turn off his own calendar invites', dadRow.calendar_invites === false)
ok('…and his role is unchanged', dadRow.role === 'viewer')
ok('last admin cannot be demoted', !!(await throws(() => as('ameet', () => db.query(`update circle_members set role='editor' where user_id=$1`, [U.ameet])))))
ok('last admin cannot be removed', !!(await throws(() => as('ameet', () => db.query(`delete from circle_members where user_id=$1`, [U.ameet])))))

console.log('Google token table')
await db.query(`insert into google_connections (circle_id, google_email, calendar_id, refresh_token_enc, scope, connected_by) values ($1,'ameet@gmail.com','cal123','SECRET','s',$2)`, [circleId, U.ameet])
ok('admin cannot read token table', (await as('ameet', () => db.query('select * from google_connections'))).rows.length === 0)
ok('calendar_status works for member', (await as('dad', () => db.query('select * from calendar_status($1)', [circleId]))).rows[0]?.calendar_id === 'cal123')
ok('calendar_status empty for stranger', (await as('stranger', () => db.query('select * from calendar_status($1)', [circleId]))).rows.length === 0)
const statusCols = Object.keys((await as('dad', () => db.query('select * from calendar_status($1)', [circleId]))).rows[0] || {})
ok('calendar_status exposes no token', !statusCols.includes('refresh_token_enc'))

console.log('Documents and confirmation')
const docId = (await as('brother', () => db.query(`insert into documents (circle_id, uploaded_by, status, visit_date, extraction) values ($1,$2,'ready','2026-11-18','{}') returning id`, [circleId, U.brother]))).rows[0].id
const items = JSON.stringify([{ kind: 'appointment', title: 'Biopsy results with Dr. Lin', urgency: 'urgent', provider: 'Dr. Lin', due_by: '2026-12-02' }, { kind: 'lab', title: 'Repeat CBC', urgency: 'soon', provider: 'dr. lin', due_by: null }])
const meds = JSON.stringify([{ name: 'Omeprazole', dose: '40 mg', change_type: 'new' }, { name: 'Aspirin', change_type: 'stopped' }])
const notes = JSON.stringify([{ body: 'Call if black stools', is_warning: true }])
await as('brother', () => db.query('select confirm_document($1,$2,$3,$4)', [docId, items, meds, notes]))
ok('confirm adds items', (await as('dad', () => db.query('select * from care_items where document_id=$1', [docId]))).rows.length === 2)
ok('provider de-duplicated case-insensitively', (await as('dad', () => db.query('select * from providers'))).rows.length === 1)
const medRows = (await as('dad', () => db.query('select name, active, start_date from medications order by name'))).rows
ok('stopped med recorded inactive', medRows.find((m) => m.name === 'Aspirin')?.active === false)
ok('med start date = visit date', String(medRows.find((m) => m.name === 'Omeprazole')?.start_date).includes('2026') )
ok('note saved with creator', (await as('dad', () => db.query('select created_by from care_notes'))).rows[0]?.created_by === U.brother)
ok('second confirm is rejected', String(await throws(() => as('ameet', () => db.query('select confirm_document($1,$2,$3,$4)', [docId, items, meds, notes])))).includes('already_confirmed'))
const doc2 = (await as('brother', () => db.query(`insert into documents (circle_id, uploaded_by, status) values ($1,$2,'ready') returning id`, [circleId, U.brother]))).rows[0].id
const badItems = JSON.stringify([{ kind: 'appointment', title: 'Fine', urgency: 'soon' }, { kind: 'NOT_A_KIND', title: 'Bad', urgency: 'soon' }])
await throws(() => as('brother', () => db.query('select confirm_document($1,$2,$3,$4)', [doc2, badItems, '[]', '[]'])))
ok('failed confirm rolls back everything', (await as('dad', () => db.query('select * from care_items where document_id=$1', [doc2]))).rows.length === 0)
ok('…and leaves the doc unconfirmed', (await as('dad', () => db.query('select confirmed_at from documents where id=$1', [doc2]))).rows[0].confirmed_at === null)
ok('viewer cannot confirm', !!(await throws(() => as('dad', () => db.query('select confirm_document($1,$2,$3,$4)', [doc2, '[]', '[]', '[]'])))))

console.log('Storage')
await as('brother', () => db.query(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${circleId}/${docId}/page-1.jpg`]))
ok('editor can upload into own circle folder', (await as('dad', () => db.query('select * from storage.objects'))).rows.length === 1)
ok('viewer cannot upload', !!(await throws(() => as('dad', () => db.query(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${circleId}/x/page.jpg`])))))
ok('stranger cannot see files', (await as('stranger', () => db.query('select * from storage.objects'))).rows.length === 0)
ok('stranger cannot upload into circle', !!(await throws(() => as('stranger', () => db.query(`insert into storage.objects (bucket_id, name) values ('documents', $1)`, [`${circleId}/x/page.jpg`])))))
const bucket = (await db.query(`select public from storage.buckets where id='documents'`)).rows[0]
ok('bucket is private', bucket.public === false)

console.log('Stranger can start their own, isolated circle')
await as('stranger', () => db.query(`select create_circle('Other','Other','UTC')`))
ok('stranger still sees none of our data', (await as('stranger', () => db.query('select * from care_items'))).rows.length === 0)
ok('we do not see theirs', (await as('ameet', () => db.query('select * from care_circles'))).rows.length === 1)

console.log(`\n${pass} passed, ${failN} failed`)
process.exit(failN ? 1 : 0)
