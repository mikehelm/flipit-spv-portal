/**
 * Database-backed verification of WP11. BUILD_SPEC §6.
 *
 * The unit tests pin the audience rules and prove the notification email cannot
 * carry a figure. This runs the real flow against a real Postgres with three
 * investors present and checks the property that only exists once there are
 * rows: **a targeted update reaches only its intended recipients.**
 *
 *   pnpm tsx scripts/verify-updates.ts
 */

import 'dotenv/config'
import { eq, like } from 'drizzle-orm'
import { db } from '@/db'
import { investorAccounts, portalUpdates, updateDeliveries, users } from '@/db/schema'
import { readServiceConfig } from '@/lib/auth/service-config'
import { portalAccess } from '@/lib/portal/access'
import { loadInvestorUpdates, loadOperatorUpdates } from '@/lib/updates/data'
import {
  createDraft,
  deleteDraft,
  editDraft,
  notifyOneRecipient,
  publishUpdate,
  resolveAudience,
  withdrawUpdate,
} from '@/lib/updates/service'

const PREFIX = 'wp11-verify'
let actor: { kind: 'user'; id: string; label: string }

let passed = 0
let failed = 0

function check(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1
    console.log(`  ok    ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

async function cleanup(): Promise<void> {
  const updates = await db
    .select({ id: portalUpdates.id })
    .from(portalUpdates)
    .where(like(portalUpdates.title, `${PREFIX}%`))

  for (const update of updates) {
    await db.delete(updateDeliveries).where(eq(updateDeliveries.updateId, update.id))
    await db.delete(portalUpdates).where(eq(portalUpdates.id, update.id))
  }

  const accounts = await db
    .select({ id: investorAccounts.id })
    .from(investorAccounts)
    .where(like(investorAccounts.email, `${PREFIX}%`))

  for (const account of accounts) {
    await db.delete(updateDeliveries).where(eq(updateDeliveries.accountId, account.id))
    await db.delete(investorAccounts).where(eq(investorAccounts.id, account.id))
  }
}

async function makeAccount(slug: string, name: string, status: 'INVITED' | 'ACTIVE' | 'SUSPENDED') {
  const [account] = await db
    .insert(investorAccounts)
    .values({ email: `${PREFIX}-${slug}@example.test`, name, status })
    .returning()
  return account!
}

async function main(): Promise<void> {
  await cleanup()

  const operator = await db.query.users.findFirst({ where: eq(users.role, 'OPERATOR') })
  if (!operator) throw new Error('No operator user. Run `pnpm db:seed` first.')
  actor = { kind: 'user', id: operator.id, label: operator.email }

  const alice = await makeAccount('alice', 'Alice Updates', 'ACTIVE')
  const bob = await makeAccount('bob', 'Bob Updates', 'ACTIVE')
  const carol = await makeAccount('carol', 'Carol Updates', 'INVITED')
  const dan = await makeAccount('dan', 'Dan Updates', 'SUSPENDED')

  const config = await readServiceConfig()
  const activeAccess = portalAccess({
    accountStatus: 'ACTIVE',
    closedAccountAccess: config.closedAccountAccess,
    serviceMode: config.serviceMode,
  })

  console.log('\nDrafting (§6)')

  const draft = await createDraft({
    title: `${PREFIX} Everyone`,
    body: 'The round is progressing well and documents go out next week.',
    audience: { kind: 'ALL' },
    notifyByEmail: true,
    authorId: operator.id,
    actor,
  })
  check('a draft is created', draft.ok)
  if (!draft.ok) throw new Error(draft.message)

  const draftRow = await db.query.portalUpdates.findFirst({
    where: eq(portalUpdates.id, draft.updateId),
  })
  check('a draft is not published', draftRow?.publishedAt === null)

  const noDeliveries = await db
    .select({ id: updateDeliveries.id })
    .from(updateDeliveries)
    .where(eq(updateDeliveries.updateId, draft.updateId))
  check('a draft has no delivery rows', noDeliveries.length === 0)

  const aliceBefore = await loadInvestorUpdates(alice.id, activeAccess)
  check(
    'a draft is on nobody’s portal',
    !aliceBefore.updates.some((row) => row.id === draft.updateId),
  )

  check(
    'a draft can be edited',
    (await editDraft({
      updateId: draft.updateId,
      title: `${PREFIX} Everyone`,
      body: 'The round is progressing well. Documents go out next week.',
      audience: { kind: 'ALL' },
      notifyByEmail: true,
      actor,
    })).ok,
  )

  console.log('\nAudience resolution (§6)')

  const all = await resolveAudience({ kind: 'ALL' })
  const allEmails = all.map((row) => row.email)
  check('ALL includes active accounts', allEmails.includes(alice.email))
  check('ALL includes invited accounts', allEmails.includes(carol.email))
  check('ALL excludes suspended accounts', !allEmails.includes(dan.email))

  const suspendedFilter = await resolveAudience({
    kind: 'STATUS',
    statuses: ['SUSPENDED'],
  })
  check('a filter naming only SUSPENDED resolves to nobody', suspendedFilter.length === 0)

  const oneSuspended = await resolveAudience({ kind: 'ONE', accountId: dan.id })
  check('a suspended account cannot be addressed individually', oneSuspended.length === 0)

  console.log('\nPublishing (§6)')

  const published = await publishUpdate({ updateId: draft.updateId, actor })
  check('publishing succeeds', published.ok)
  if (!published.ok) throw new Error(published.message)
  check('it reports how many portals it reached', published.recipients >= 3)

  const aliceAfter = await loadInvestorUpdates(alice.id, activeAccess)
  check('it appears on the investor portal', aliceAfter.updates.some((row) => row.id === draft.updateId))
  check('it carries a published date', aliceAfter.updates[0]?.publishedAt instanceof Date)

  const republished = await publishUpdate({ updateId: draft.updateId, actor })
  check('publishing twice is refused', !republished.ok)

  const editAfterPublish = await editDraft({
    updateId: draft.updateId,
    title: 'Changed after the fact',
    body: 'Changed after the fact.',
    audience: { kind: 'ALL' },
    notifyByEmail: true,
    actor,
  })
  check('a published update cannot be edited (§6 immutability)', !editAfterPublish.ok)
  check(
    'and the refusal says a correction is a new update',
    !editAfterPublish.ok && editAfterPublish.message.includes('correction'),
  )

  const stillOriginal = await db.query.portalUpdates.findFirst({
    where: eq(portalUpdates.id, draft.updateId),
  })
  check('the published text is untouched', stillOriginal?.title === `${PREFIX} Everyone`)

  const deleteAfterPublish = await deleteDraft({ updateId: draft.updateId, actor })
  check('a published update cannot be deleted', !deleteAfterPublish.ok)

  console.log('\nA targeted update reaches only its recipients (§6)')

  const targeted = await createDraft({
    title: `${PREFIX} For Bob alone`,
    body: 'Bob, a note about your own documents.',
    audience: { kind: 'ONE', accountId: bob.id },
    notifyByEmail: false,
    authorId: operator.id,
    actor,
  })
  if (!targeted.ok) throw new Error(targeted.message)
  const targetedPublished = await publishUpdate({ updateId: targeted.updateId, actor })
  check('a targeted update publishes to one person', targetedPublished.ok && targetedPublished.recipients === 1)

  const bobFeed = await loadInvestorUpdates(bob.id, activeAccess)
  const aliceFeed = await loadInvestorUpdates(alice.id, activeAccess)
  const carolFeed = await loadInvestorUpdates(carol.id, activeAccess)

  check('the intended recipient sees it', bobFeed.updates.some((row) => row.id === targeted.updateId))
  check(
    'nobody else sees it',
    !aliceFeed.updates.some((row) => row.id === targeted.updateId) &&
      !carolFeed.updates.some((row) => row.id === targeted.updateId),
  )
  check(
    "and its text does not appear in anybody else's feed",
    !JSON.stringify(aliceFeed).includes('a note about your own documents'),
  )
  check(
    "no other investor's name appears in an investor's feed",
    !JSON.stringify(aliceFeed).includes('Bob Updates'),
  )

  const statusTargeted = await createDraft({
    title: `${PREFIX} Invited only`,
    body: 'A note for people who have not opened their invitation yet.',
    audience: { kind: 'STATUS', statuses: ['INVITED'] },
    notifyByEmail: false,
    authorId: operator.id,
    actor,
  })
  if (!statusTargeted.ok) throw new Error(statusTargeted.message)
  await publishUpdate({ updateId: statusTargeted.updateId, actor })

  check(
    'a status-filtered update reaches only that status',
    (await loadInvestorUpdates(carol.id, activeAccess)).updates.some(
      (row) => row.id === statusTargeted.updateId,
    ) &&
      !(await loadInvestorUpdates(alice.id, activeAccess)).updates.some(
        (row) => row.id === statusTargeted.updateId,
      ),
  )

  const emptyAudience = await createDraft({
    title: `${PREFIX} Nobody`,
    body: 'Addressed to a status nobody may be addressed in.',
    audience: { kind: 'STATUS', statuses: ['SUSPENDED'] },
    notifyByEmail: false,
    authorId: operator.id,
    actor,
  })
  if (!emptyAudience.ok) throw new Error(emptyAudience.message)
  const publishedToNobody = await publishUpdate({ updateId: emptyAudience.updateId, actor })
  check('publishing to an empty audience is refused', !publishedToNobody.ok)

  console.log('\nNotifying — one recipient at a time (§6, §14)')

  const notify = await notifyOneRecipient({
    updateId: draft.updateId,
    accountId: alice.id,
    actor,
  })
  check(
    'sending is refused here, with a specific reason from the gate',
    !notify.ok && notify.message.length > 40,
    notify.ok ? 'it sent' : undefined,
  )
  if (!notify.ok) console.log(`        reason: ${notify.message.slice(0, 100)}…`)

  const aliceDelivery = await db.query.updateDeliveries.findFirst({
    where: eq(updateDeliveries.accountId, alice.id),
  })
  check('a refused notification is not marked as sent', aliceDelivery?.notifiedAt === null)

  const notifyStranger = await notifyOneRecipient({
    updateId: targeted.updateId,
    accountId: alice.id,
    actor,
  })
  check(
    'somebody outside the audience cannot be notified about it',
    !notifyStranger.ok && notifyStranger.message.includes('not among'),
  )

  console.log('\nWithdrawal leaves a tombstone (§6)')

  const noReason = await withdrawUpdate({ updateId: draft.updateId, reason: 'oops', actor })
  check('withdrawing without a real reason is refused', !noReason.ok)

  const withdrawn = await withdrawUpdate({
    updateId: draft.updateId,
    reason: 'The date in the second sentence was wrong; a correction follows.',
    actor,
  })
  check('withdrawing with a recorded reason succeeds', withdrawn.ok)

  const afterWithdraw = await loadInvestorUpdates(alice.id, activeAccess)
  check(
    'it disappears from every portal',
    !afterWithdraw.updates.some((row) => row.id === draft.updateId),
  )
  check(
    'and no tombstone is shown to the investor',
    !JSON.stringify(afterWithdraw).toLowerCase().includes('withdrawn'),
  )

  const row = await db.query.portalUpdates.findFirst({
    where: eq(portalUpdates.id, draft.updateId),
  })
  check('the row itself is kept', row !== undefined)
  check('with the reason recorded', (row?.withdrawnReason ?? '').includes('correction follows'))

  const keptDeliveries = await db
    .select({ id: updateDeliveries.id })
    .from(updateDeliveries)
    .where(eq(updateDeliveries.updateId, draft.updateId))
  check('the delivery rows are kept as the record of who received it', keptDeliveries.length >= 3)

  const notifyWithdrawn = await notifyOneRecipient({
    updateId: draft.updateId,
    accountId: bob.id,
    actor,
  })
  check('a withdrawn update cannot be notified about', !notifyWithdrawn.ok)

  console.log('\nThe operator’s view')

  const operatorView = await loadOperatorUpdates()
  const ours = operatorView.filter((update) => update.title.startsWith(PREFIX))
  check('every update appears, including drafts and withdrawn ones', ours.length === 4)
  check(
    'the audience is described',
    ours.find((u) => u.id === targeted.updateId)?.audienceLabel.includes('Bob Updates') === true,
  )
  check(
    'the recipients are listed against a published update',
    (ours.find((u) => u.id === targeted.updateId)?.recipients.length ?? 0) === 1,
  )

  await cleanup()

  const orphans = await db
    .select({ id: portalUpdates.id })
    .from(portalUpdates)
    .where(like(portalUpdates.title, `${PREFIX}%`))
  check('verification data is removed', orphans.length === 0)

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit(process.exitCode ?? 0))
