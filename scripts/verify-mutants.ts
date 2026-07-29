/**
 * The checks, checked. Break the thing on purpose and see whether anybody
 * notices.
 *
 * Four PROGRESS.md entries in a row have ended with the same open item, and it
 * has been the most productive one every time: **how many checks in this
 * repository cannot fail?** Three answers so far, each found by hand:
 *
 *   - An assertion that the overview banner had disappeared, written against
 *     the plural sentence, tested against a database whose banner said the
 *     singular. It had passed on every run and the banner was there every time.
 *   - Twenty-one `every()` calls on collections a query returned, where an empty
 *     result reports `ok` and establishes nothing.
 *   - Twelve negated `some()` calls, the same defect with the polarity reversed,
 *     and most of them the privacy promises.
 *
 * The first two of those were found by *changing the thing under test and
 * watching what stayed green*, and the third by looking for the shape of the
 * second. That method works and it has been applied by hand, eight times, across
 * four sessions. Nothing runs it.
 *
 * This does. Each entry below names a claim this application makes, the smallest
 * change to the production code that makes the claim **false**, and the check
 * that is supposed to report it. It applies the change, runs that check, and
 * fails if the check passed.
 *
 * **A surviving mutant is a check that cannot fail.** Not a slow check or a weak
 * check — one that reports success about a system that has stopped doing the
 * thing it is reporting on.
 *
 * ## What it is careful about
 *
 * It edits files in `src/` and puts them back. That is the only way to do this
 * without a second checkout, and it is worth being explicit about the care:
 *
 *   - The original bytes are read into memory **before** anything is written,
 *     and written back in a `finally`. Not `git checkout` — a working tree with
 *     uncommitted work in it is the ordinary state during a build session, and a
 *     tool that quietly reverted somebody's edits would be a far worse thing
 *     than the one it is looking for.
 *   - The restore is **verified** by reading the file back and comparing. A
 *     restore that silently failed would leave a mutated repository looking
 *     healthy, which is precisely the class of defect this file exists for.
 *   - `SIGINT` and `SIGTERM` restore before exiting, so the answer to a run that
 *     is taking too long is still Ctrl-C.
 *   - The search string of every mutation is asserted to appear **exactly once**
 *     before anything is written. A mutation whose target has been reworded
 *     would otherwise silently apply nothing and report the check as having
 *     caught it.
 *
 * ## What a failure here means
 *
 *   MUTANT SURVIVED  the mutation was applied, the check ran, and the check
 *                    passed. Read the claim and the check named beside it: one
 *                    of them is wrong.
 *   NOT APPLIED      the search string is no longer in the file, or is there
 *                    more than once. The mutation needs rewriting; nothing has
 *                    been proved either way.
 *
 * Run it with:
 *
 *   pnpm verify:mutants
 */

import 'dotenv/config'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

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

interface Mutation {
  /** The claim, in the words the repository uses about it. */
  claim: string
  /** The file to change. Relative to the repository root. */
  file: string
  /** The exact text to replace. Must appear exactly once. */
  find: string
  /** What to put there instead — the smallest change that breaks the claim. */
  replace: string
  /** The command that is supposed to notice, as `pnpm <this>`. */
  noticedBy: string
  /**
   * What the failure should say, when it is a named check rather than a whole
   * test file. Optional: for a vitest run, a non-zero exit is the whole signal.
   */
  says?: RegExp
}

/**
 * One entry per claim worth breaking.
 *
 * Weighted towards the twelve-point review checklist at the end of
 * `CODEX_TASKS.md`, because those are the twelve things somebody will read this
 * repository to satisfy themselves about, and "there is a test for it" is a
 * weaker sentence than "here is the test failing when it is not true".
 */
const MUTATIONS: readonly Mutation[] = [
  {
    // Checklist 1.
    claim: 'money and percentages are never a JavaScript number',
    file: 'src/lib/money.ts',
    find: '  return spv.times(share).toFixed()',
    replace: '  return String(Number(spvPercentage) * Number(flipitShare))',
    noticedBy: 'vitest run src/lib/money.test.ts',
  },
  {
    // Checklist 4.
    claim: 'the operator can never record, amend or void a compliance approval',
    file: 'src/lib/compliance/authority.ts',
    find: "  if (role === 'OWNER') return { allowed: true, role: 'OWNER' }",
    replace:
      "  if (role === 'OWNER' || role === 'OPERATOR') return { allowed: true, role: 'OWNER' }",
    noticedBy: 'vitest run src/lib/compliance/authority.test.ts',
  },
  {
    // Checklist 12, and §18.1 — the gate that keeps a testing deployment from
    // issuing portal links that die when the application moves.
    claim: 'the app refuses to send when its base URL is not the production one',
    file: 'src/lib/email/transport/guard.ts',
    find: '  if (!isTest && !isProduction) {',
    replace: '  if (!isTest && !isProduction && false) {',
    noticedBy: 'vitest run src/lib/email/transport/guard.test.ts',
  },
  {
    // The one an erasure is for. A pseudonym that keeps the name is not one.
    claim: 'an erased investor keeps no name',
    file: 'src/lib/erasure/plan.ts',
    find: '  return `Erased investor ${pseudonymRef(rowId)}`',
    replace: '  return `Erased investor ${rowId}`',
    noticedBy: 'verify:erasure',
    says: /name|pseudonym/i,
  },
  {
    // The rule the last two sessions were about: a finding on the health page
    // and not on the overview banner.
    claim: 'a rule the banner could afford is a rule the banner carries',
    file: 'src/lib/health/rules.ts',
    find: '    ...erasureFindings(facts),\n    // Both halves of the storage question',
    replace: '    // Both halves of the storage question',
    noticedBy: 'vitest run src/lib/health/banner-parity.test.ts',
  },
  {
    // The ordering defect `appearsBefore` was written for. Rescheduling a
    // reminder a run is genuinely still working on is how a message gets sent
    // twice, which is why the remedy names the lock probe first.
    claim: 'the stuck-reminder remedy sends the reader to the lock probe first',
    file: 'src/lib/health/rules.ts',
    find:
      "        '`pnpm reminders:lock` says whether a run is genuinely in progress. If it answers ' +\n" +
      "        'FREE, reschedule the reminder from the reminders page, which releases it. Check the ' +",
    replace:
      "        'If nothing is running, reschedule the reminder from the reminders page, which ' +\n" +
      "        'releases it. Check the ' +",
    noticedBy: 'verify:health',
    says: /lock probe/,
  },
  {
    // Checklist 5. The privacy claims that `noneOf` was written for: a feed
    // that has stopped returning anything satisfies every negative asked of it.
    claim: 'an update sent to one investor appears in nobody else’s portal',
    file: 'src/lib/updates/data.ts',
    find: "  if (!canView) return { updates: [], canView: false }",
    replace:
      "  if (!canView) return { updates: [], canView: false }\n" +
      "  if (accountId !== '') return { updates: [], canView: true }",
    noticedBy: 'verify:updates',
    says: /nobody else sees it/,
  },
  {
    // Checklist 2. §8.2 item 1 — "No approval, no send."
    claim: 'no send path bypasses the compliance approval',
    file: 'src/lib/compliance/gate.ts',
    find: "  if (!approval || drift.state === 'NO_APPROVAL') {",
    replace: "  if (false) {",
    noticedBy: 'vitest run src/lib/compliance/gate.test.ts',
  },
  {
    // Checklist 3. The pre-flight step that names the excluded recipients is
    // ATTESTED and says "Everybody else is unaffected". Making it enforce a
    // failure turns one recipient in a country the approval does not cover
    // into a batch that cannot be sent at all.
    claim: 'a jurisdiction block stops one recipient, never the whole batch',
    file: 'src/lib/sending/preflight.ts',
    find: "    ...attestationState('JURISDICTIONS_IDENTIFIED', input.attestations, null),",
    replace:
      "    ...attestationState('JURISDICTIONS_IDENTIFIED', input.attestations, null),\n" +
      "    state: jurisdictionBlocks.length === 0 ? ('PASS' as const) : ('FAIL' as const),",
    noticedBy: 'vitest run src/lib/sending/preflight.test.ts',
  },
  {
    // Checklist 6. A token stored as the token is a token in a database dump.
    claim: 'claim and sign-in tokens are hashed at rest',
    file: 'src/lib/crypto.ts',
    find: "  return createHash('sha256').update(token).digest('base64url')",
    replace: '  return token',
    noticedBy: 'vitest run src/lib/crypto.test.ts',
  },
  {
    // Checklist 7. Suspension has to do both halves: revoke what exists and
    // refuse to issue anything new. Issuing a new link to a suspended account
    // is the half that is easy to lose in a refactor.
    claim: 'suspension refuses a new link as well as revoking the old ones',
    file: 'src/lib/portal/access.ts',
    find:
      "      return { capability: 'NONE', issueLink: false, allowClaim: false, notice: 'SUSPENDED' }",
    replace:
      "      return { capability: 'NONE', issueLink: true, allowClaim: false, notice: 'SUSPENDED' }",
    noticedBy: 'verify:lifecycle',
  },
  {
    // Checklist 9. §15 — nothing but the anti-phishing page may be indexed.
    claim: 'no route but the verification page is indexable',
    file: 'src/lib/verify/robots.ts',
    find: "      disallow: withBasePath('/'),",
    replace: '      disallow: [],',
    noticedBy: 'vitest run src/lib/verify/robots.test.ts',
  },
  {
    // Checklist 10. `publishBlock` is what refuses to publish an entry whose
    // wording still identifies the person who asked it.
    claim: 'a published Q&A entry carries nothing identifying',
    file: 'src/lib/qa/anonymity.ts',
    find: '  if (publishBlock(entry) !== null) return null',
    replace: '  if (false) return null',
    noticedBy: 'verify:qa',
  },
  {
    // Checklist 11. The AI proposes a *column mapping* and nothing else — it
    // never supplies a value and never names a field this import does not have.
    // Accepting an unknown target is how a model's invention would reach a row.
    claim: 'the AI path cannot map a column to anything but a field of this import',
    file: 'src/lib/import/ai.ts',
    find: '    if (!isTargetField(target)) {',
    replace: '    if (false) {',
    noticedBy: 'vitest run src/lib/import/ai.test.ts',
  },
  {
    // The partner of the Q&A guard the sweep found untested last time, and it
    // resolves the other way. `data.ts` excludes withdrawn entries in SQL and
    // `toPublicEntry` excludes them again; the second exists for "a caller that
    // forgets the `unpublishedAt is null` clause", so it is unreachable through
    // `loadSharedQa` **by construction** and `verify:qa` cannot exercise it.
    //
    // The sweep said so — the mutation survived `verify:qa` — and the honest
    // answer was not a new fixture but the right witness: a projection-level
    // guarantee is tested at the projection level, and `anonymity.test.ts`
    // already drives it. Recorded here because "the check named beside the
    // claim is the wrong one" is a real outcome of this file and looks nothing
    // like the other one.
    claim: 'a withdrawn Q&A entry is refused by the projection, not only by the query',
    file: 'src/lib/qa/anonymity.ts',
    find: '  if (entry.unpublishedAt !== null) return null',
    replace: '  if (false) return null',
    noticedBy: 'vitest run src/lib/qa/anonymity.test.ts',
  },

  // -------------------------------------------------------------------------
  // Checklist 8 — never log a credential, an email body, or the OpenAI key.
  //
  // Four entries in a row recorded this point as having no mutation, each with
  // the same reasoning: it is a property of every log statement in the
  // repository rather than of one function, so there is no single line to
  // break. The reasoning is right about the shape and was wrong about the
  // conclusion.
  //
  // Point 8 is defended in four places, and each of them has a line:
  //
  //   - `Secret` makes a credential inert in a template literal;
  //   - `scrubSecrets` removes one from text a transport handed back;
  //   - `assertNoSecrets` throws rather than write a forbidden key to the
  //     audit log;
  //   - and everything left over is a *set* of console calls, which
  //     `src/lib/security/logging.test.ts` enumerates.
  //
  // The last two below are mutated the other way round: rather than removing a
  // defence they add the defect — a body printed in a send path, and a new log
  // line in a module that is not allowed one — and ask whether anybody
  // notices. They are the only mutations in this file that *insert* code. The
  // defects this repository has actually shipped were omissions, so having a
  // pair of the other shape is worth the asymmetry.
  // -------------------------------------------------------------------------
  {
    // Checklist 8. The class exists so a stray `console.log(transport)` prints
    // `[redacted]`. Give it back its value and it prints the app password.
    claim: 'a credential prints as [redacted], whatever is done to it',
    file: 'src/lib/email/transport/secret.ts',
    find: "  toString(): string {\n    return '[redacted]'\n  }",
    replace: '  toString(): string {\n    return this.#value\n  }',
    noticedBy: 'vitest run src/lib/email/transport/secret.test.ts',
  },
  {
    // Checklist 8. The last thing between a credential and the audit log, for
    // text this application did not author — an error object from a transport
    // library. Its own comment says it should never fire in practice, and a
    // mutation is how "should never" is told apart from "cannot".
    claim: 'a credential is scrubbed out of text a transport handed back',
    file: 'src/lib/email/transport/secret.ts',
    find: '    result = result.split(raw).join(REDACTED)',
    replace: '    result = result.split(raw).join(raw)',
    noticedBy: 'vitest run src/lib/email/transport/secret.test.ts',
  },
  {
    // Checklist 8. The audit log is the one store in this application exported
    // wholesale, so a body in a metadata cell leaves the building through a
    // door the investor never sees. Drop the two content keys from the list.
    claim: 'an email body cannot be written to the audit log',
    file: 'src/lib/audit.ts',
    find: '|htmlbody|textbody|body|transcript)/i',
    replace: '|htmlbody|textbody)/i',
    noticedBy: 'vitest run src/lib/audit.test.ts',
  },
  {
    // Checklist 8, inverted: not a defence removed but the defect itself, in
    // the place it would really happen — somebody debugging a send, printing
    // the thing they are debugging, and leaving it in.
    claim: 'no log line anywhere prints an email body',
    file: 'src/lib/sending/send-invitation.ts',
    find: '  const snapshotId = snapshot!.id',
    replace: '  const snapshotId = snapshot!.id\n  console.log(rendered.html)',
    noticedBy: 'vitest run src/lib/security/logging.test.ts',
  },
  {
    // And the inventory, which is the half of that file a body-shaped mutation
    // does not reach: a new console call in the shipped application, printing
    // nothing sensitive at all, is still a decision somebody has to state.
    claim: 'a new log line in the shipped application has to be declared',
    file: 'src/lib/media/reconcile.ts',
    find: 'export async function countTrackedFiles',
    replace: 'console.log("counting")\nexport async function countTrackedFiles',
    noticedBy: 'vitest run src/lib/security/logging.test.ts',
  },
  {
    // §13, and the third coat of the vacuity defect. Moving a contact address
    // kills every session and every outstanding link, because the commonest
    // reason to move one in a hurry is that the old mailbox is no longer yours.
    //
    // The check for it was `liveSessions.length === 0`, which is satisfied by a
    // session that was never created and by a `where` clause that stopped
    // matching. It is now `emptyBeside(after, before)`, with the same query run
    // before the act as the control. This mutation is the proof: stop revoking,
    // and it fails.
    claim: 'moving a contact address kills every session and every outstanding link',
    file: 'src/lib/portal/email-change.ts',
    find: '  await revokeAllPortalAccess(account.id)',
    replace: '  void revokeAllPortalAccess',
    noticedBy: 'verify:email-change',
    says: /every session was ended/,
  },
  {
    // The mutation that tells the two forms of the same check apart.
    //
    // "A suspended account sees no shared entries" was
    // `suspendedView.shared.length === 0`, and this is what that cannot see: a
    // loader that has stopped returning anything to *anybody*. The count is
    // green, and the sentence it is reporting — that suspension is what emptied
    // the page — is false.
    //
    // With `emptyBeside(suspendedView.shared, liveNeighbour.shared)` it fails,
    // because the live neighbour's page went empty too. Run `verify:qa` against
    // this mutation with the old form restored and it reports `ok`.
    claim: 'a suspended account sees nothing because it is suspended, not because the page is broken',
    file: 'src/lib/qa/data.ts',
    find: "  const shared = state === 'VISIBLE' ? await loadSharedQa() : []",
    replace: '  const shared: Awaited<ReturnType<typeof loadSharedQa>> = []',
    noticedBy: 'verify:qa',
    says: /FAIL\s+the control sees a shared entry|FAIL\s+a suspended account sees no shared entries/,
  },

  // -------------------------------------------------------------------------
  // The checking machinery itself, and mutations that DELETE.
  //
  // Two shapes have been recorded as missing for four entries, and they are the
  // same gap read two ways.
  //
  //   - ***Nothing mutates the verification scripts.*** Every mutation above
  //     breaks something in `src/`. But the banner defect — the one that
  //     started this whole line of work — was **in a script**, and so was the
  //     `.every()` family, and so was the `indexOf` ordering. The scripts are
  //     where this repository's checks have actually been wrong.
  //   - ***Every mutation rewrites a line; none deletes one.*** The defects this
  //     repository has actually shipped were omissions — a rule missing from a
  //     list, a fix applied to two files of five. A rewrite and a deletion are
  //     not the same experiment.
  //
  // The four below are both at once: each deletes or downgrades something in
  // the checking machinery, and the check that notices is a **unit test**
  // reading the scripts' source. That is the layer that has to hold, because
  // there is nothing below it — a verification script that has stopped checking
  // reports its own success.
  // -------------------------------------------------------------------------
  {
    // The `everyOf` guard, downgraded to the language's own `every` — which is
    // `true` for an empty collection, which is exactly the twenty-one-site
    // defect that produced `everyOf` in the first place.
    claim: 'no verification script calls every() on something a query returned',
    file: 'scripts/verify-roadmap.ts',
    find: '    everyOf(seeded, (tile) => !tile.label.includes(ROADMAP_DISCLAIMER)) &&',
    replace: '    seeded.every((tile) => !tile.label.includes(ROADMAP_DISCLAIMER)) &&',
    noticedBy: 'vitest run src/lib/verify/vacuous.test.ts',
  },
  {
    // A sixth copy of the browser launch, which is the defect `chromium.test.ts`
    // says in as many words is the only thing it exists to prevent. Two places
    // deciding which browser to use is how five scripts ended up disagreeing.
    claim: 'one file decides which Chromium the checks launch',
    file: 'scripts/verify-media.ts',
    find: "import 'dotenv/config'",
    replace: "import 'dotenv/config'\nimport { chromium } from 'playwright'\nconst _b = () => chromium.launch({})",
    noticedBy: 'vitest run src/lib/verify/chromium.test.ts',
  },
  {
    // A **deletion**: one verification removed from the runner's list. It still
    // exists, `pnpm verify:roadmap` still works, and `pnpm verify:all` — the
    // command run before a release — silently stops running it. The total stays
    // green and the coverage shrinks by one. This is the omission shape, and it
    // is the exact rot `verify-all.test.ts` was written against.
    claim: 'verify:all runs every verification that exists',
    file: 'scripts/verify-all.ts',
    find: "  { name: 'roadmap', proves: 'the portal roadmap tiles' },\n",
    replace: '',
    noticedBy: 'vitest run src/lib/verify/verify-all.test.ts',
  },
  {
    // The other deletion, and the one this session put in reach: a file removed
    // from the log inventory. The call stays where it is; only the declaration
    // that somebody thought about it goes. An inventory that can lose an entry
    // without complaining is a list of opinions, not a check.
    claim: 'the log inventory cannot lose an entry quietly',
    file: 'src/lib/security/logging.test.ts',
    find: "    file: 'src/app/api/health/route.ts',\n    calls: 1,",
    replace: "    file: 'src/app/api/health/route.ts',\n    calls: 0,",
    noticedBy: 'vitest run src/lib/security/logging.test.ts',
  },
]

/** What a run of one check produced. */
interface Outcome {
  code: number
  out: string
}

function run(command: string): Outcome {
  const result = spawnSync('pnpm', command.split(' '), {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 64 * 1024 * 1024,
  })
  return {
    code: result.status ?? 1,
    out: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

/** Every file this run has touched, and the bytes it found there. */
const originals = new Map<string, string>()

function restoreEverything(): void {
  for (const [path, content] of originals) {
    try {
      writeFileSync(path, content, 'utf8')
    } catch (error) {
      console.error(`\n  COULD NOT RESTORE ${path} — ${String(error)}`)
      console.error('  Run `git checkout --` on it before doing anything else.')
    }
  }
}

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    restoreEverything()
    process.exit(1)
  })
}

async function main(): Promise<void> {
  console.log('\nThe checks, checked — one broken claim at a time\n')

  for (const mutation of MUTATIONS) {
    const path = join(root, mutation.file)
    const before = readFileSync(path, 'utf8')
    originals.set(path, before)

    const occurrences = before.split(mutation.find).length - 1
    if (occurrences !== 1) {
      check(
        `${mutation.claim}: the mutation still applies`,
        false,
        `NOT APPLIED — the text appears ${occurrences} times in ${mutation.file}`,
      )
      originals.delete(path)
      continue
    }

    let outcome: Outcome
    try {
      writeFileSync(path, before.replace(mutation.find, mutation.replace), 'utf8')
      outcome = run(mutation.noticedBy)
    } finally {
      writeFileSync(path, before, 'utf8')
      const after = readFileSync(path, 'utf8')
      if (after !== before) {
        console.error(`\n  RESTORE FAILED for ${mutation.file}. Run \`git checkout --\` on it.`)
        process.exit(1)
      }
      originals.delete(path)
    }

    const noticed = outcome.code !== 0
    const saidSo = mutation.says === undefined || mutation.says.test(outcome.out)

    check(
      `${mutation.claim} — broken, and \`pnpm ${mutation.noticedBy}\` fails`,
      noticed,
      noticed ? undefined : 'MUTANT SURVIVED — the check reported success',
    )
    if (noticed) {
      check(
        `  and it says which, rather than merely exiting non-zero`,
        saidSo,
        saidSo ? undefined : `nothing in the output matched ${mutation.says}`,
      )
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`)
  if (failed > 0) process.exitCode = 1
}

main()
  .catch((error) => {
    restoreEverything()
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => process.exit())
