# Open Decisions — before the build starts

**Version 6.0 · 2026-07-25**

Settled in v2: owner is Michael Helm `mike@flipthepage.com`; operator is David Serene `serenedavid@gmail.com`; investors hold persistent accounts; the two pre-launch gates are specified in Build Spec §8.

What follows is what still needs an answer. Ordered by how much rework a late answer causes.

---

## Settled on 2026-07-25

- Sender: `serenedavid@gmail.com` · one-at-a-time sending, no bulk send · 15–40 recipients
- Same response deadline for everyone
- Automatic reminders to non-responders: **in v1**
- AI-assisted spreadsheet import with an owner-supplied API key: **in v1**
- Hosting: `invest.flipit.com`, managed Postgres and queue, roughly USD 20–50/month
- Retention: indefinite — the portal becomes David's ongoing surface for SPV members
- Compliance: David, via the BVI/HK formation agents
- Branding: FLIPIT palette from the demo file, plus an admin image library
- Optional personal video from David, previewed and published by him
- No round-progress or other-investor visibility until after the round closes
- Funds received: recorded by David alone
- Hosting: **`mikehelm.com/SPV`** to test, **`spv.flipit.com`** before anything is sent
- Owner sign-in: both `mike@flipthepage.com` and `mike@flipit.com` allowlisted
- AI: **OpenAI**, key entered in-app by Mike, used transparently by David, with a spend cap
- David's contact method (phone / WhatsApp / email-only) collected at operator onboarding
- Round closes when **David presses the button** — the app reminds him, never closes it for him
- Invitation is a **designed HTML email**, not plain text
- Build: **in-house, here**
- **Shared Q&A**: investors ask, answers private by default, David ticks a box to publish anonymised — **visible from the start**
- Extras in v1: **participation certificate PDF**, **anti-phishing verification page**, and a **register of interest** (§5.2) — explicitly non-promissory
- US recipient: **held**, with an in-app explanation to David
- No hard close date — David closes when ready
- Product demo in the portal: **decide after seeing the build**
- **Sending is Gmail SMTP with an app password** — no Google verification, no wait, no 7-day expiry

---

## Still open — in priority order

### 1. The US recipient — get advice before sending to them

One recipient is a US person. That is the highest-risk item in the project and the app now blocks that recipient by default (§8.3) while everyone else proceeds. **Recommendation: send to the other recipients, hold the US one pending advice.** One conversation, one person delayed. The alternative is unwinding an offer already made.

### 2. ~~Google verification~~ — no longer needed

Sending now goes over Gmail SMTP with an app password (spec §8.1). No verification, no waiting period, no demo video, no 7-day expiry. **This is off the critical path entirely.** All David has to do is turn on 2-Step Verification if it is not already on, and generate an app password — a two-minute job the onboarding walks him through.

The only remaining item on the critical path is the compliance approval below.

### 3. Confirm the formation agents are reviewing the *email*, not just the structure

BVI/HK formation agents set up the SPV. That is not the same as approving the wording of a solicitation sent to named individuals in their own countries. Worth one direct question to David: *has anyone read the investor email and confirmed we can send it to these particular people, in these particular countries?* Nothing sends until that approval is recorded.

### 4. Approved jurisdiction list

Known so far: Australia, England, France, Thailand, USA (blocked), and others to confirm. Each needs to be on the approved list before its recipient can be sent to. UK financial-promotion rules and Australian small-scale offer thresholds are the usual ones to check.

### 5. ~~David's phone number~~ — resolved. Collected during his onboarding, along with whether he prefers phone, WhatsApp, or email only.

### 6. Privacy policy text

No longer required for Gmail verification, but still worth having given the personal and financial data held. Can be drafted here.

### 7. Fallback contact if David is unavailable

The portal's closed and suspended states need an address someone will still be reading.

**Half-answered by the build.** There is now a place to put it — the *service contact address* in settings — and it is rendered where it is needed: underneath the sending address on a suspended or concluded account, and *alone* once the portal is closing or closed, because that is the point at which the sending address stops being monitored. The health report says so when it is empty, and refuses in the settings form for sunset and disabled. **What is still open is whose address it should be.**

### 8. Ask David whether he wants to do a video

Optional, and entirely his call — but it is the highest-impact thing on the list and costs him ten minutes with a phone. Worth asking before the build finishes so there is a slot for it.

### 9. Confirm the brand palette against the live site

The colours in §13.2 come from your demo file, not from flipit.com directly — the live site returned nothing useful to an automated fetch. A two-minute eyeball check before launch.

---

## Raised by the build, and still unanswered

These two have been recorded in PROGRESS.md across several sessions as questions for you. They are here because that is where questions for you belong.

### 10. A forgotten password

Sign-in for you and David is an email address and a password. **There is no way to reset one.** An account gets in through a setup link, which the other of you can mint — so if you forget yours, David can issue you a new setup link, and vice versa. If *both* of you are locked out at once, nobody can get in without a command line and a database.

That is probably acceptable for two people, and it is deliberately not built, because a reset journey is a second way into the application and every one of them is a way in for somebody else too. The question is whether you want one, and if so:

- a reset link emailed to the address on the account — which means the application sends mail to a real address on an unauthenticated request, and the anti-phishing page (§15.1) exists precisely because that is the shape a phishing email takes;
- or the current arrangement, written down: **if you are locked out, ask David to mint you a setup link, and if you are both locked out, that is a database job.**

Nothing needs deciding before launch. It needs deciding before there is a third administrator.

### 11. An SPV percentage that will not divide

The application refuses an import file when the **derived** Flipit percentage needs more than six decimal places, and tells the operator to round the SPV percentage in the spreadsheet.

The arithmetic: the indirect Flipit percentage is `spv_percentage × 0.30` (§10). An SPV percentage of `41.666667` — one third of 125%, the shape a three-way split produces — derives `12.5000001`. Seven decimals into a column that stores six, so the file is refused.

**The awkward part is that this happens even when the file supplies the indirect percentage explicitly.** The `indirect_flipit_percentage_override` column exists for exactly this: the operator writes `12.5` and that is the figure stored and sent. The derived figure is discarded — but it is computed and rejected *first*, so the file is still refused, and the message asks the operator to change the SPV percentage, which is a real figure that will appear in an investment document.

Three ways out, and this is your call because it is a figures question, not a code one:

- **Leave it.** A file that will not divide cleanly is worth a second look, and a refusal is the safe direction.
- **Skip the derived check when an override is present.** The discarded number stops blocking the file. This is a change to the money path, which nothing has changed lightly.
- **Keep the refusal and change the message**, so it says the override does not rescue the row and why.

Nothing is blocked on this. It will only be met by a file with an awkward split in it, and no such file exists yet.

---

## Worth deciding, not blocking

- **Does the raise have a hard close date** the portal should display?
- **Should the shared Q&A be visible during the raise, or held until the round closes?** It names nobody, but its existence implies other recipients. Default is visible — a well-answered Q&A probably does more for confidence than the inference costs. One switch either way.
- **Who may delete investor data**, and after how long? Currently owner-only, indefinite retention.
- **Confirm the name spelling** — "David Serene" appears throughout and will sit on investment correspondence.

---

## Noted, no action needed yet

- The `SPV/` folder is the natural home for this application; it is currently empty.
- The FLIPIT product itself (`flipit/`) is at M1 — runnable locally, extension builds working, M2–M4 stubbed. Investors asking "what actually exists?" can be shown it. Whether any of that belongs in the portal as a Flipit progress update is a later question, but the updates feed (§6) is where it would live.
