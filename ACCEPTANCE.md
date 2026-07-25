# Acceptance criteria — BUILD_SPEC §22

**This file is generated. Do not edit it — run `pnpm acceptance`.**

Every criterion below is quoted word for word from BUILD_SPEC §22; a test
reads the specification and fails if this table paraphrases it. Every
citation names a test or check that exists — the same test resolves each one
against the real label in the real file, so a renamed or deleted test breaks
the map rather than leaving a citation pointing at nothing.

46 of 48 criteria have at least one automated check. 4 carry a written note.

Where a check runs:

- **unit** — `pnpm test`.
- **database** — `pnpm tsx scripts/verify-*.ts`, against real Postgres.
- **browser** — `pnpm verify:viewport`, in Chromium at 375px.

## 1. Uploading the sample CSV creates valid recipient records; a file with errors cannot be sent.

- `src/lib/import/table.test.ts` — unit — "reads a CSV into headers and rows"
- `src/lib/import/validate.test.ts` — unit — "one bad row stops the whole file, including the good rows"
- `src/lib/sending/review.test.ts` — unit — "never removes a blocked recipient from the table — it is shown, not hidden"

## 2. Indirect ownership is calculated correctly, stored as an exact decimal, and the override is respected.

- `src/lib/money.test.ts` — unit — "computeIndirectPercentage — BUILD_SPEC §10"
- `src/lib/import/validate.test.ts` — unit — "respects an override and warns that it differs from the calculation"
- `src/db/schema.test.ts` — unit — "has no floating-point column holding a value"

## 3. The preview exactly matches the sent email snapshot.

- `src/lib/sending/approved-source.test.ts` — unit — "loads the template the same way on both sides of the gate"
- `src/lib/email/render.test.ts` — unit — "renders the invitation with every figure in both parts"
- `src/lib/sending/snapshot.test.ts` — unit — "renders the preview from the same source the send snapshots"
- `src/lib/sending/snapshot.test.ts` — unit — "has no second rendering path anywhere in the application"
- `src/lib/sending/snapshot.test.ts` — unit — "differs from the email it will send only in the claim token"
- `src/lib/sending/snapshot.test.ts` — unit — "stores the rendered subject and both bodies rather than re-rendering"

## 4. Each send produces one personalized email to one recipient and records its result individually. No bulk-send path exists anywhere in the UI or API.

- `src/lib/email/transport/retry.test.ts` — unit — "takes one message, not a list — there is no bulk entry point"
- `src/lib/email/transport/retry.test.ts` — unit — "reports every attempt so a send event can be written for each"
- `src/lib/sending/snapshot.test.ts` — unit — "writes exactly one snapshot and one send event per call"
- `src/lib/sending/snapshot.test.ts` — unit — "takes a single recipient and offers no list parameter"
- `src/lib/sending/snapshot.test.ts` — unit — "exposes no bulk send in the server action or the row it is bound to"

## 5. Investor links reveal no personal data in the URL.

- `src/db/schema.test.ts` — unit — "portal tokens store only a hash (§15)"
- `src/lib/crypto.test.ts` — unit — "issues at least 128 bits of entropy"
- `src/lib/crypto.test.ts` — unit — "stores a hash that does not contain the token"
- `scripts/verify-lifecycle.ts` — database — "and works exactly once"
- `scripts/verify-lifecycle.ts` — database — "two simultaneous redemptions produce exactly one success"
- `scripts/verify-lifecycle.ts` — database — "an expired claim link is refused"
- `scripts/verify-lifecycle.ts` — database — "no token is stored in the clear — only its hash"
- `src/lib/portal/links.test.ts` — unit — "reveals no part of the recipient’s name or address, in any encoding"
- `src/lib/portal/links.test.ts` — unit — "reveals no offer id, account id, amount or percentage"
- `src/lib/portal/links.test.ts` — unit — "no portal route accepts anything but a token in its URL"
- `src/lib/portal/links.test.ts` — unit — "cannot be pointed at a host a caller supplied"

## 6. Sending is impossible without a current compliance approval, and editing one character of the template disables sending until re-approval.

- `src/lib/compliance/gate.test.ts` — unit — "refuses a perfectly good recipient when no approval exists"
- `src/lib/compliance/drift.test.ts` — unit — "one changed character in the body voids the approval"
- `src/lib/compliance/drift.test.ts` — unit — "one changed character in the subject voids the approval"
- `src/lib/sending/approved-source.test.ts` — unit — "compares the rendered template hash with the approved hash before sending"

## 7. A recipient in a jurisdiction outside the approved list is blocked individually, with the reason shown, while the rest of the batch proceeds.

- `src/lib/compliance/gate.test.ts` — unit — "blocks the US recipient alone while everyone else stays sendable"
- `src/lib/compliance/explain.test.ts` — unit — "says the rest of the round is unaffected"

## 8. The dashboard shows mail connection health, and a missing or rejected credential blocks sending with a specific message.

- `src/lib/email/transport/health.test.ts` — unit — "reports a healthy connection with the authenticated address — §8.1"
- `src/lib/email/transport/guard.test.ts` — unit — "1. blocks when the credential is missing, and says so"

## 9. Claiming an invitation creates a verified, persistent investor account that can be signed back into later without the original link.

- `src/lib/portal/access.test.ts` — unit — "invited: the claim link works and nothing else exists yet"
- `src/lib/portal/sign-in-email.test.ts` — unit — "states the expiry plainly, so a cold link reads as expected"
- `scripts/verify-lifecycle.ts` — database — "an unaffected investor can still get one"

## 10. Suspending or closing an account immediately ends its sessions and invalidates its links. A suspended account cannot obtain a new sign-in link. A closed account can, and reaches a read-only view, when `closed_account_access` is `read_only`.

- `src/lib/portal/access.test.ts` — unit — "suspended: no new link, no access, and a neutral notice"
- `src/lib/portal/access.test.ts` — unit — "closed with read_only: may sign back in, read only"
- `scripts/verify-lifecycle.ts` — database — "every session is revoked"
- `scripts/verify-lifecycle.ts` — database — "every unspent link is revoked"
- `scripts/verify-lifecycle.ts` — database — "and may not be issued a new link"

## 11. An investor sees their status advance through commitment, acceptance, and funds received, with the amounts and dates the operator recorded.

- `src/lib/portal/timeline.test.ts` — unit — "marks earlier steps done, this one current and the rest ahead"
- `src/lib/portal/timeline.test.ts` — unit — "writes a complete sentence when a fact is genuinely absent"
- `scripts/verify-certificate.ts` — database — "the stage moved to funds received"

## 12. Recording funds received requires two-step confirmation and is written to the audit log.

- `scripts/verify-certificate.ts` — database — "without the confirmation tick, nothing is recorded"
- `scripts/verify-certificate.ts` — database — "a mismatched re-typed amount records nothing"
- `scripts/verify-certificate.ts` — database — "and truly nothing was written"
- `src/lib/audit-coverage.test.ts` — unit — "records nothing when the confirmation is not ticked"
- `src/lib/audit-coverage.test.ts` — unit — "records nothing when the re-typed amount is a cent out"
- `src/lib/audit-coverage.test.ts` — unit — "records the action string the criterion names"
- `src/lib/audit-coverage.test.ts` — unit — "keeps the bank reference off the funds-received entry (§5)"

## 13. A published update appears in the intended investors' portals and in no one else's, and its notification email contains no financial detail.

- `src/lib/updates/audience.test.ts` — unit — "resolves an empty filter to nothing rather than to everybody"
- `src/lib/updates/notification.test.ts` — unit — "contains no amount and no percentage"
- `src/lib/updates/notification.test.ts` — unit — "does not name the update it is announcing"
- `scripts/verify-updates.ts` — database — "a targeted update publishes to one person"
- `scripts/verify-updates.ts` — database — "the intended recipient sees it"

## 14. Setting the service to read-only, sunset, or disabled produces the behaviour in §7, and the owner retains access and export throughout.

- `src/lib/portal/access.test.ts` — unit — "the service mode can only ever narrow access"
- `src/lib/portal/access.test.ts` — unit — "sunset still lets an investor in to take their records away"
- `scripts/verify-rounds.ts` — database — "gives an active investor"
- `scripts/verify-export.ts` — database — "the export itself is audited"
- `src/lib/export/secrets.test.ts` — unit — "produces the same export bytes whatever mode the service is put into"
- `src/lib/export/secrets.test.ts` — unit — "puts no service-mode precondition anywhere in the export path"
- `src/lib/export/secrets.test.ts` — unit — "gates each export route on identity alone"

## 15. An investor account can hold a second offer under a second round without schema changes.

- `src/db/schema.test.ts` — unit — "investor accounts carry no round reference — they are durable (§4.3)"
- `src/db/schema.test.ts` — unit — "an offer belongs to a round and an account, so accounts outlive rounds (§4.3)"
- `src/db/second-offer.test.ts` — unit — "holds a second offer under a second round with no schema change"
- `src/db/second-offer.test.ts` — unit — "matches an incoming row to the account that already exists"
- `src/db/second-offer.test.ts` — unit — "scopes the recipient row to its round, so the same address can appear in the next one"

## 16. David can reply and the message is logged against the correct record and thread.

- `src/lib/qa/service.test.ts` — unit — "re-opens when a follow-up arrives after the reply (§6.7.1)"
- `scripts/verify-qa.ts` — database — "a follow-up joins the existing thread"
- `scripts/verify-qa.ts` — database — "the thread message is from the investor"

## 17. Mike can view and export all data, including the audit log.

- `src/lib/export/export.test.ts` — unit — "is separate and rejects an operator at the Zod boundary"
- `scripts/verify-export.ts` — database — "the audit formatter refuses a non-owner request outright"

## 18. Unauthorized users cannot access investor or admin records. An unknown address cannot sign in and no record is created for it. Sign-in is enumeration-resistant: an unknown address and a wrong password fail identically.

- `src/lib/auth/credentials.test.ts` — unit — "fails identically for an unknown address and a wrong password"
- `src/lib/auth/credentials.test.ts` — unit — "creates nothing for an unknown address"
- `src/lib/auth/sign-in-policy.test.ts` — unit — "has no self-registration path of any kind"
- `src/lib/portal/sign-in-timing.test.ts` — unit — "settles on every single return, with none left unpadded"

## 19. The operator cannot record, amend, or void a compliance approval; the control is owner-only and the attempt is logged.

- `src/actions/compliance.test.ts` — unit — "logs every refused attempt, naming the action and the role (§22 AC19)"
- `src/lib/compliance/authority.test.ts` — unit — "refuses the operator every one of them — record, amend and void included"

## 20. Sending is unavailable in `read_only`, `sunset`, and `disabled` service modes.

- `src/lib/email/transport/guard.test.ts` — unit — "3. blocks when the service mode is not ACTIVE, naming the mode"

## 21. A recipient row missing `sender_phone` with no configured default is caught at pre-flight, before the batch starts — not as a mid-batch failure.

- `src/lib/email/render.test.ts` — unit — "catches a missing sender_phone with no configured default, before any send"
- `src/lib/sending/preflight.test.ts` — unit — "rendering and sender identity — AC21"

## 22. A file containing an invalid jurisdiction code blocks the whole file; a file containing a valid code that is merely outside the approved list does not.

- `src/lib/import/validate.test.ts` — unit — "an invalid ISO country code — AC22"
- `src/lib/import/validate.test.ts` — unit — "a valid code outside the approved list — AC7, AC22, §8.3"
- `src/lib/compliance/jurisdictions.test.ts` — unit — "rejects anything that is not an assigned ISO 3166-1 alpha-2 code"

## 23. A spreadsheet with unfamiliar column names, extra columns and mixed date formats produces a mapping proposal that David can correct, and imports correctly once confirmed.

- `src/lib/import/mapping.test.ts` — unit — "reads a column by what is in it when the header is unhelpful"
- `src/lib/import/mapping.test.ts` — unit — "asks about a date column that could go either way"
- `src/lib/import/table.test.ts` — unit — "names empty and duplicated headers rather than losing them"

## 24. The app imports a file with no AI key configured, using manual column mapping.

- `src/lib/import/validate.test.ts` — unit — "produces byte-identical figures whether the mapping came from a model or a dropdown"
- `src/lib/import/mapping.test.ts` — unit — "proposeMappingFromHeaders — the no-key path, AC24"

## 25. The AI key is never displayed after saving, never logged, and never exported.

- `src/lib/crypto.test.ts` — unit — "never reveals whether a value is long, short, or what it starts with"
- `src/lib/email/transport/secret.test.ts` — unit — "cannot be reached by JSON.stringify, even nested"
- `src/lib/audit.test.ts` — unit — "names every offending key so the fix is obvious"
- `scripts/verify-export.ts` — database — "no metadata key looks like a credential or a body"
- `src/lib/export/secrets.test.ts` — unit — "names no credential in any recipient or audit export header"
- `src/lib/export/secrets.test.ts` — unit — "never selects, decrypts or returns the stored key from the settings action"
- `src/lib/export/secrets.test.ts` — unit — "has no console call in any export module, export route or settings file"
- `src/lib/export/secrets.test.ts` — unit — "reads the key the settings action itself uses, and reads it at every depth"

## 26. A percentage column that could read as 5% or 0.05 raises an explicit question rather than being coerced.

- `src/lib/import/mapping.test.ts` — unit — "refuses to proceed while an ambiguity is unanswered — AC26"

## 27. No AI output is used in any monetary calculation — the indirect-ownership figure is identical whether or not AI was used to import.

- `src/lib/import/validate.test.ts` — unit — "produces byte-identical figures whether the mapping came from a model or a dropdown"
- `src/lib/import/ai.test.ts` — unit — "carries no numbers across the boundary — only column names"

## 28. A reminder sends only to non-responders, respects the per-recipient cap, contains no offer terms, and requires its own approved template.

- `src/lib/reminders/eligibility.test.ts` — unit — "refuses every recorded response"
- `src/lib/reminders/schedule.test.ts` — unit — "never plans more than the cap"
- `src/lib/reminders/eligibility.test.ts` — unit — "refuses the one that would exceed it"
- `src/lib/reminders/no-offer-terms.test.ts` — unit — "the built-in reminder passes its own gate"
- `src/lib/reminders/schedule.test.ts` — unit — "loads the compliance context for REMINDER and never for INVITATION"
- `scripts/verify-reminders.ts` — database — "a responder is never queued"

## 29. A queued reminder can be cancelled before it sends, and the cancellation is logged.

- `scripts/verify-reminders.ts` — database — "a queued reminder can be cancelled"

## 30. The "Coming to your portal" tiles render without promising returns, dates, or specific functionality, and are configurable by the owner.

- `src/lib/portal/roadmap.test.ts` — unit — "rejects a promise of return, valuation or liquidity"
- `src/lib/portal/roadmap.test.ts` — unit — "rejects a timeline — §13.1: "No dates. No soon.""
- `src/lib/portal/roadmap.test.ts` — unit — "is rendered beneath the tiles on the investor portal"
- `src/lib/audit-coverage.test.ts` — unit — "calls the one audit helper from inside its own body"
- `src/lib/audit-coverage.test.ts` — unit — "names every exported reminder mutation that writes to the database"
- `src/lib/audit-coverage.test.ts` — unit — "registers cancelMany even though it delegates its writes"

**Note.** Half of this is not built. The wording constraint is enforced, and the standing line §13.1 requires is on the page and cannot be switched off. "Configurable by the owner" is not: the tiles are seeded and there is no screen to add, rename or hide one. `forbiddenWordsInTileLabel` is the gate that surface must call, and it exists ahead of it.

## 31. The portal renders correctly and legibly at 375px width, and text contrast meets WCAG AA against the dark palette.

- `scripts/verify-viewport.ts` — browser — "no horizontal scroll"
- `scripts/verify-viewport.ts` — browser — "every rendered string meets AA"
- `src/lib/brand.contrast.test.ts` — unit — "dim on bg — the one the specification names"
- `src/lib/palette.test.ts` — unit — "no screen contains a hex colour literal"

## 32. An uploaded image is served from the app's own domain, stripped of EXIF, and available to both the portal and the email templates.

_No automated check._

**Note.** Not built. WP15 is deferred until somewhere to store a file is chosen — see the WP16 entry in PROGRESS.md for why base64-in-Postgres and a writable disk were both rejected. There is nothing to test and nothing that pretends there is.

## 33. David can record or upload a video, preview it in the real portal layout, replace it, and publish it — and nothing is investor-visible until he publishes.

_No automated check._

**Note.** Not built, and deferred for the same reason as AC32: §13.3 wants recorded or uploaded video hosted on the application's own domain and served only to authenticated investors, and there is nowhere to put the file. §13.3 also says the whole feature is optional and removable, and that if David never records one the portal shows no gap where it would have been — which is the state today.

## 34. The flow prompts David to send himself a complete test invitation, including his video, before any real send is possible.

- `src/lib/email/transport/guard.test.ts` — unit — "refuses a test send addressed to anyone but the operator"
- `src/lib/email/transport/guard.test.ts` — unit — "still requires a working credential — there is nothing to test with"

**Note.** The test send exists and is locked to the operator's own address. What is not built is the prompt — §13.3 wants it offered in the flow rather than found — and "including his video" depends on AC33. The half that protects a real recipient is in place; the half that is a nudge is not.

## 35. No investor-facing screen reveals the existence, identity, count, or aggregate contribution of any other investor.

- `src/lib/qa/anonymity.test.ts` — unit — "carries no account id anywhere in its serialised form"
- `src/lib/register/copy.test.ts` — unit — "never tells the investor how many people are on it"
- `src/lib/portal/timeline.test.ts` — unit — "nothing in the timeline reveals another investor — §15"
- `scripts/verify-qa.ts` — database — "no other account id appears"
- `scripts/verify-register.ts` — database — "no position appears"
- `scripts/verify-register.ts` — database — "no count appears"

## 36. A question submitted from the portal reaches David's queue and emails him, and the asker sees a confirmation.

- `src/lib/qa/service.test.ts` — unit — "waits when there is no answer at all"
- `src/lib/qa/messages.test.ts` — unit — "says plainly that nothing has gone to the investor yet"
- `scripts/verify-qa.ts` — database — "a notification that cannot be sent does not lose the question"
- `src/lib/qa/defaults.test.ts` — unit — "confirms in the words PORTAL_COPY uses, once the question is recorded"
- `src/lib/qa/defaults.test.ts` — unit — "is the same confirmation whatever the account, and repeats nothing back"
- `src/lib/qa/defaults.test.ts` — unit — "confirms even when the notification to David could not get out"

## 37. An answer defaults to private — visible only to the asker — and is published only when the box is explicitly ticked.

- `src/lib/qa/visibility.test.ts` — unit — "still lets a read-only visitor read their own correspondence"
- `scripts/verify-qa.ts` — database — "saving does not publish"
- `src/lib/qa/defaults.test.ts` — unit — "hands recordAnswer publish false when the field never arrives"
- `src/lib/qa/defaults.test.ts` — unit — "reads a field that never arrived as unticked"
- `src/lib/qa/defaults.test.ts` — unit — "has no visibility flag anywhere in the module that defaults to true"

## 38. A published entry shows no name, initials, email, or identifying timestamp, and David can rewrite the question text for publication while the original is preserved on the record.

- `src/lib/qa/anonymity.test.ts` — unit — "exposes exactly six fields and no more"
- `src/lib/qa/anonymity.test.ts` — unit — "publishes the rewritten wording, never the original"
- `src/lib/qa/anonymity.test.ts` — unit — "never leaks a day"
- `src/db/schema.test.ts` — unit — "a Q&A entry keeps the original question separate from the published one (§6.7)"
- `scripts/verify-qa.ts` — database — "the shared page carries no asker name"

## 39. The answer email to the asker is not sent until David presses send.

- `scripts/verify-qa.ts` — database — "saving does not send"

## 40. David can create and publish a Q&A entry with no question behind it.

- `src/lib/qa/service.test.ts` — unit — "treats a seeded entry with no investor messages as settled"
- `scripts/verify-qa.ts` — database — "the operator can write an entry directly (§6.7.4)"
- `scripts/verify-qa.ts` — database — "a seeded entry has no asker in the queue"

## 41. Unpublishing removes an entry from the shared page and is audit-logged.

- `scripts/verify-qa.ts` — database — "an entry can be unpublished"

## 42. Reaching Funds received generates a branded PDF certificate the investor can download, carrying the correct figures and the not-a-share-certificate footer.

- `src/lib/certificate/pdf.test.ts` — unit — "says it is not a share certificate and not a title document"
- `src/lib/certificate/pdf.test.ts` — unit — "prints the figures exactly as recorded, without rounding or reformatting"
- `scripts/verify-certificate.ts` — database — "a certificate is issued"
- `scripts/verify-certificate.ts` — database — "carrying the investor’s name"
- `scripts/verify-certificate.ts` — database — "the amount received"
- `src/lib/audit-coverage.test.ts` — unit — "gives each audited mutation an action string of its own"
- `src/lib/qa/anonymity.test.ts` — unit — "returns null for a withdrawn entry even if the flag was left set"

## 43. The anti-phishing page is publicly reachable without sign-in, is the only indexed route, and names the exact sending address and link domain.

- `src/lib/verify/verify.test.tsx` — unit — "renders without an authentication dependency and uses configured facts"
- `src/lib/verify/robots.test.ts` — unit — "opts exactly two pages into indexing, and names them"
- `src/lib/verify/robots.test.ts` — unit — "allows the verification page back in"
- `scripts/verify-viewport.ts` — browser — "the verification page is reachable with no session at all"
- `scripts/verify-deployment.ts` — database — "${BASE_PATH}${path} is indexable"

## 44. The app refuses to send real invitations when its configured base URL is not the production value.

- `src/lib/email/transport/guard.test.ts` — unit — "4. blocks when this is not the production deployment"
- `src/lib/env.test.ts` — unit — "marks the testing deployment as not production"
- `src/lib/env.test.ts` — unit — "production deployment guard (BUILD_SPEC §18.1, AC44)"
- `scripts/verify-deployment.ts` — database — "a real invitation is refused off the production deployment"
- `scripts/verify-deployment.ts` — database — "a test send to the operator is still allowed here"

## 45. The blocked US recipient produces an explanation to the operator, and can only be unblocked with a recorded approval reference.

- `src/lib/compliance/explain.test.ts` — unit — "says exactly what unblocking requires — a recorded reference"
- `src/lib/compliance/gate.test.ts` — unit — "does not unblock without a reference — there is no blanket unblock"
- `src/actions/compliance.test.ts` — unit — "has no exported action that unblocks a jurisdiction for everybody"

## 46. An investor can join and leave the register of interest from their portal, and never sees their position or anyone else's.

- `src/lib/register/copy.test.ts` — unit — "never uses queue language in the investor-facing copy"
- `scripts/verify-register.ts` — database — "they can see that they are on the register"
- `scripts/verify-register.ts` — database — "an investor can remove themselves"
- `scripts/verify-register.ts` — database — "and the portal reflects it immediately"

## 47. The register order is computed from funds-received date, then commitment date, then join date, and an operator override requires a recorded reason.

- `src/lib/register/order.test.ts` — unit — "puts settled funds first, then commitments, then everyone else"
- `src/lib/register/order.test.ts` — unit — "an override needs a recorded reason (§5.2.2)"
- `scripts/verify-register.ts` — database — "an override with a thin reason is refused"
- `scripts/verify-register.ts` — database — "clearing the override restores the computed order"

## 48. An offer issued from the register passes through the jurisdiction gate and compliance approval exactly as an original offer does.

- `src/lib/compliance/offers.test.ts` — unit — "blocks everyone when there is no approval at all"
- `src/lib/compliance/offers.test.ts` — unit — "blocks an uncleared jurisdiction and leaves the cleared ones alone"
- `scripts/verify-register.ts` — database — "an offer to an uncleared jurisdiction is still created"
- `scripts/verify-register.ts` — database — "and is blocked individually by the gate"
