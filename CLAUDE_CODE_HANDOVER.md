# Prompt for Claude Code — assess, then decide

Paste the fenced block into Claude Code on Michael's Mac, in
`/Users/otto/Documents/spv`.

It is deliberately an **assessment** brief, not an implementation brief. It asks
for a report before anything is changed.

---

```
You are picking up the Flipit SPV Investor Portal at /Users/otto/Documents/spv.

A cloud session (Claude in Cowork, no access to this machine) has been building
against the GitHub remote all day. Your first job is NOT to continue that work.
It is to decide whether it is any good, whether it fits what is actually on this
disk, and to report before changing anything.

Be sceptical. The cloud session could not run the application, could not see a
browser, and could not reach this machine. Several of its conclusions are
inferences. Say so where you find them.

═══════════════════════════════════════════════════════════════
FIRST — SURVEY. Change nothing yet.
═══════════════════════════════════════════════════════════════

  git status
  git log --oneline -5
  git stash list

This working copy has roughly 22 dirty or untracked paths, including an
access-request feature that exists in NO other copy — not on the remote, not
anywhere. Establish exactly what they are before you do anything else. If this
disk fails, that work is gone.

Then look at what the remote has that you do not:

  git fetch origin
  git log --oneline HEAD..origin/main
  git diff --stat HEAD...origin/main

Expect roughly nine commits. Do not merge yet.

═══════════════════════════════════════════════════════════════
WHAT THE CLOUD SESSION BUILT, AND WHY
═══════════════════════════════════════════════════════════════

Read PROGRESS.md from the bottom up — each entry has Built / Decisions /
Deviations / Checklist / Uncertain, and the Uncertain lists are honest. In order:

1. CHANGE OF CONTACT EMAIL (§13). `email_change_requests` shipped in migration
   0000 with no reader and no writer. An investor can now move their address,
   effective only when they open a single-use link in the NEW mailbox. Fills
   §20's `updated contact email` export column, which was hard-coded null.
   Judge: is the collision behaviour right? Asking to move to an address another
   record holds returns the SUCCESS sentence, writes nothing, sends nothing —
   on the grounds that a distinguishable refusal lets a signed-in investor walk
   a list of addresses and learn who else was invited (§15).

2. ACKNOWLEDGEMENT CHECKBOXES (§13, §8.2). Did not exist at all. §8.2 requires
   approved wording be applied "without a code change". Owner-only screen. An
   acknowledgement stores a COPY of the wording plus a revision, so editing
   wording later cannot rewrite what somebody already agreed to.
   Judge: required only for INTERESTED, never for declining or asking a
   question. The reasoning is that a toll on declining pushes people toward
   silence, and silence is not a decline. Agree or not.

3. OPERATOR CONTACT ON THE PORTAL (§2.1, §13). whatsappLink() was written in
   WP2 and imported by nothing, so the only contact route in the application
   appeared on notices for suspended and closed accounts.

4. VIEWER ROLE — read-only oversight for grahambrain@gmail.com. Scope B, chosen
   by Michael: every investor by name, all four amounts, documents, the
   conversation thread, status history. NOT the audit log, export, compliance,
   settings, import, or the register's order.
   THIS IS THE ONE TO SCRUTINISE HARDEST. The approach: rather than adding
   VIEWER to `PrivilegedRole` (which ~40 mutation guards consult), currentAdmin()
   was narrowed to return `ActingAdmin` and to answer null for a viewer, so
   every existing call site keeps its behaviour and read access is granted one
   page at a time via requireReader(). Nothing opened by default.
   Judge: is that actually airtight? Try to find a mutation a viewer can reach.
   src/lib/auth/viewer-role.test.ts has 30 tests, most negative. Attack them.
   VIEWER_EMAILS is empty — Graham has no account.

5. SECURE COOKIE FIX — the most important one. Both session modules derived
   `secure` from APP_URL, which is deliberately held at http://localhost:3000
   so the §18.1 send guard refuses. Served over HTTPS, that meant session
   cookies issued WITHOUT Secure — sent in the clear on any http:// request
   before Cloudflare's redirect. PUBLIC_ORIGIN now answers that question
   separately. Links deliberately still use APP_URL, because a portal link
   embeds the domain it was issued from and letting a pre-launch deployment
   mint real-looking links is the failure §18.1 exists to prevent.
   Judge: verify the actual Set-Cookie header on a running server. The cloud
   session could only assert this at the source level.

6. CSP, HSTS, PERMISSIONS-POLICY. Two deliberate non-obvious choices:
   camera=(self) and microphone=(self), because §13.3 records video in the
   browser through getUserMedia and camera=() breaks it SILENTLY; and
   script-src keeps 'unsafe-inline' because Next injects inline bootstrap, with
   a nonce named as the proper fix.
   Judge: DRIVE A REAL BROWSER. Open the video recorder, an image upload, the
   email template preview, and the certificate PDF, and watch the console for
   CSP violations. The cloud session used curl and explicitly could not do this.
   Also note: next.config.ts headers are baked at BUILD time, so PUBLIC_ORIGIN
   must be set when `pnpm build` runs, not only when `pnpm start` runs.

7. macOS TEST PORTABILITY. Two descriptor-leak assertions read /proc/self/fd,
   which this machine does not have. Now /dev/fd, which both platforms have. It
   THROWS rather than skipping if neither is readable.
   Judge: run `pnpm test` and confirm 2,312 pass with zero failures here. This
   is the one claim that can only be proven on this machine.

═══════════════════════════════════════════════════════════════
WHAT IS NOT DONE
═══════════════════════════════════════════════════════════════

- THE DEPLOYMENT IS BROKEN. spv.flipit.ltd returns Cloudflare 530. The launchd
  plist at /Library/LaunchDaemons/com.cloudflare.cloudflared.plist was written
  by the installer with only /opt/homebrew/bin/cloudflared and no `tunnel run`
  subcommand, so the daemon exits 1 in a KeepAlive loop. CODEX_FIX_PROMPT.md in
  this repo has the full repair and nine other deployment tasks. This is the
  only thing standing between the work above and a working portal.
- xlsx@0.18.5 parses uploaded spreadsheets and has live advisories. SheetJS
  moved off npm, so the patched release means installing from a URL and
  provenance matters more than speed. Untouched.
- A viewer cannot enrol two-factor — /admin/security calls requireAdmin, which
  now refuses them. An account that sees every investor's financial position
  should be able to add a second factor. Clearest gap.
- No operator screen shows what an investor acknowledged, or reverses a
  contact-address change. Both recorded, neither displayed.
- No password-reset journey. `pnpm setup-link` mints a fresh one, so nobody is
  locked out, but the operator cannot self-serve.
- §13.1's "more prominent once an investor reaches Commitment agreed" and §7's
  configurable sunset notice are specified and unbuilt.
- BUILD_SPEC §2.2 says Argon2id; the code uses Node's scrypt. Reasoned at length
  at the head of src/lib/auth/password.ts and the spec now points at it. Judge
  whether that reconciliation is adequate or whether it should be argon2.

═══════════════════════════════════════════════════════════════
WHAT MICHAEL WANTS FOR THE LOOK AND FEEL — tell him if he is wrong
═══════════════════════════════════════════════════════════════

His words, and the context matters: the ~40 investors are friends who already
invested in Flipit. They know the product. This round is small — nominal
amounts — and is being offered as a gift of an opportunity, structured properly
so it is a legitimate investment rather than a handshake. He is not marketing to
them. He wants the portal to feel like something cared for: "being nice to show
them something cool that we've actually taken care of them."

He has a separate design exploration for flipit.com (the marketing site) with
four ideas: a cursor-tracking lens revealing annotations; a WebGL page-peel; a
particle "signal field"; a kinetic headline. Plus quieter interior ones:
specular sheen tracking the cursor across cards, a magnetic CTA, staggered
spring physics on list items, a logo flip. Those prototypes are for flipit.com
and are NOT in this repo.

What he wants here is some of that quality in the SPV portal.

The cloud session's recommendation, which you should challenge:

  - Sign-in page: QUIET. At most the existing page-curl brand mark with a real
    spring on hover. Two reasons. First, §15.1 — an investor arrives braced for
    a scam, having been told to TYPE the URL rather than click, and flashy is
    what a phishing page looks like while sober is what a bank looks like.
    Second, half will open the email on a phone where cursor effects do not
    exist, and it is all coming through a home connection off a Mac.
  - Inside, after sign-in: as much craft as he likes. Specular sheen on the
    offer card, staggered springs on the eight-step timeline, a magnetic
    response button. Low compliance surface, high perceived care.
  - The real moment worth effort is NOT the login page. It is when funds are
    confirmed and the participation certificate appears. Make that feel like a
    small ceremony and he will be remembered fondly. A login screen is seen once.
  - The line that matters is DECORATIVE versus DEMONSTRATIVE. Light, motion and
    physics are free. Anything that DEPICTS product capability — review pins,
    ratings, a flagged button — is a representation about the business on a page
    attached to a securities offer, and if any of it is aspirational it is a
    forward-looking claim in visual form. §13.1 already warns this section is
    "the easiest place in the build to say something unintended".

Michael has explicitly invited you to tell him he is wrong. If you think the
sign-in page should carry more, or that the certificate moment is the wrong
place to spend, say so and say why. He would rather be argued with than agreed
with.

Constraints that are not opinions: prefers-reduced-motion must be honoured,
375px is the design width and must be correct before desktop, WCAG 2.2 AA
contrast including --dim on --bg, and every investor-facing screen must work
with no cursor at all.

═══════════════════════════════════════════════════════════════
RULES THAT DO NOT BEND
═══════════════════════════════════════════════════════════════

1. NEVER send email — not a test, not to yourself.
2. NEVER make APP_URL equal PRODUCTION_APP_URL. That inequality is the safety
   catch on a securities solicitation and Michael releases it himself.
3. Never weaken or add an override to the compliance gate, the mail-connection
   gate or the base-URL guard.
4. Never a JavaScript number for money or a percentage, anywhere. Values arrive
   as strings, become decimal.js, leave as strings.
5. A jurisdiction block stops one recipient, never the whole batch.
6. The operator can never record, amend or void a compliance approval.
7. No investor-facing page, response or error may reveal that another investor
   exists.
8. Never log a credential, an email body, or an API key.
9. No bulk send. One recipient at a time, by design.
10. Never commit .env. Preserve the uncommitted pnpm-workspace.yaml change.
11. Do not add grahambrain@gmail.com to anything. Granting the viewer role is
    one line in .env and it hands a third party sight of every named investor's
    financial position. Michael's own act.
12. Where the specification is silent, choose the more conservative option and
    record it under Decisions.

Stack, fixed: Next.js 16 App Router · TypeScript strict · Tailwind v4 · Drizzle
with postgres-js (NOT Prisma) · Auth.js · Zod · decimal.js · Vitest · pnpm.
Sign-in is email and password, NOT Google OAuth.

═══════════════════════════════════════════════════════════════
THE REPORT — before you change anything
═══════════════════════════════════════════════════════════════

  1. The 22 dirty paths: what they are, what the access-request feature does,
     and whether it conflicts with the remote's nine commits. Name the files
     that would conflict.
  2. Your verdict on each of the seven items above: SOUND, SOUND WITH
     RESERVATIONS, or WRONG — with reasons. Do not be polite about it.
  3. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` on this machine,
     with the actual numbers. The suite should be 2,312 with no failures.
  4. The real Set-Cookie header from a running server, and whether Secure is
     present with PUBLIC_ORIGIN set.
  5. Any CSP violation you see in a real browser console — recorder, upload,
     template preview, certificate PDF.
  6. Whether you found any mutation a VIEWER can reach. Say how hard you tried.
  7. Your view on the visual plan, including where you think it is wrong.
  8. A recommended order for what remains, and what you would drop.

Then STOP and wait for Michael. Do not merge, do not implement, do not fix the
tunnel until he has read the report — with one exception: if you find something
actively dangerous, say so at the top and say plainly whether it can wait.

No claims without fresh evidence from this machine.
```

---

## Also — rescue the prototypes before they vanish

The three effects prototypes live in `/home/claude/flipit/` **in another cloud
sandbox**. That directory is ephemeral: when that session is reclaimed, they are
gone. No repo, no branch, no copy.

If you want them, paste this into that chat now:

> Send me `seam-lens.html`, `peel.html` and `signal-field.html` as files right
> now, before anything else. They only exist in your sandbox and it gets
> reclaimed. Then, in five lines: which of the three actually landed, what
> surprised you when you saw it running, and which one you would cut.

Once you have the files, they're just HTML — open them in a browser, judge them,
and keep them somewhere real. They belong to whichever repo hosts flipit.com,
not to this one.
