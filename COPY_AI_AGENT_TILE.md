# Proposed copy — the AI agent tile

**For the compliance approver, alongside the invitation email.**

BUILD_SPEC §13.1 asks for exactly this review, and says why: *"it is the easiest
place in the build to say something unintended."* This is investor-facing copy on
a securities offer page. Nothing below is built yet.

---

## One naming problem first

**It cannot be called "Coming soon."**

§13.1: *"No dates. No 'soon'."* And this is not advisory — `roadmap.ts` has a
forbidden-word list that already contains `soon`, `shortly`, `imminent`, and the
quarters. The settings screen would **refuse** a tile called "Coming soon" and
name the word back at you.

The reason is worth keeping in mind rather than routing around: "soon" is a
timeline, a timeline on a securities page is a representation, and this is a
feature nobody has committed a date to.

**The existing section is already called "Coming to your portal"** — the spec's
own phrase, chosen to avoid this. So:

- **Tab name: `What's ahead`** — short, fits a tab, no timeline.
- The tiles inside keep the existing "Coming to your portal" heading.
- Tapping the **Direct line to David** tile opens the panel below.

---

## The panel

### Heading

> **A direct line, in your own words**

### Body

> We are building an assistant into this portal that you can simply ask.
>
> Rather than waiting on an email, you will be able to type a question the way
> you would say it out loud and get an answer drawn from your own record and
> from everything Flipit has published — the updates, the documents issued to
> you, the answers David has already given to others, and the process itself.
>
> It is being built to know the detail, so that you do not have to keep any of
> it in your head.

### What you will be able to ask

> - *"Where has my participation got to, and what happens next?"*
> - *"What did the last update actually say?"*
> - *"Remind me what indirect Flipit interest means."*
> - *"Which documents have been issued to me, and have I read them all?"*
> - *"What has been built since I came in?"*
> - *"Has anyone else asked about the SPV structure, and what was the answer?"*

### The line that follows, always

> Features shown are in development, are indicative only, and form no part of
> the investment being offered.

*(This is `ROADMAP_DISCLAIMER`, rendered from a constant. There is no setting
that removes it and no tile edit that can hide it.)*

---

## Three examples I have deliberately left out

Each is the obvious thing to write and each is the thing §13.1 exists to stop.
Worth seeing them named, because they will occur to somebody later.

| Would read well | Why it cannot go on the page |
|---|---|
| *"What is my stake worth now?"* | **Valuation.** A private SPV interest has no marked price, and inviting the question implies there is one. |
| *"When should I expect a return?"* | **Returns and a timeline**, in six words. |
| *"Can I sell my position if I need to?"* | **Liquidity.** Nothing here is liquid and nothing should suggest it might be. |

The six that survived are all about *tooling and communication* — which is the
test §13.1 sets, and which an assistant answering questions genuinely passes. The
feature is fine. It is the framing that has to stay disciplined.

---

## One thing to decide before it is ever built

The teaser is safe. **The assistant itself is a different question**, and it is
worth flagging now rather than discovering it later.

An assistant answering questions about a securities investment is, in substance,
answering on Flipit's behalf. Two consequences:

1. **It must never state a figure that is not on the investor's own record.** The
   same rule as checklist item 11 — no AI path may produce or alter a financial
   figure. Answers about money should read from the record and quote it, never
   compute or paraphrase it.
2. **It must decline valuation, return and liquidity questions**, in a fixed
   sentence, rather than attempting an answer. Investors will ask. The
   interesting design work is that refusal, not the answers.

Neither is a reason not to build it. Both are reasons the approver should see the
assistant's own wording when the time comes, in the same way they are seeing this.

---

## What I would build now, if you approve the wording

- The `What's ahead` tab, and the panel above.
- The **Direct line to David** tile becomes tappable — it currently renders as a
  name and nothing else, which is the whole "list of promises" problem §13.1
  warns about. A tile you can open and read is a system being built; a tile you
  cannot is a promise.
- The copy lives in a constant beside `ROADMAP_DISCLAIMER`, so it can be reviewed
  as a piece of text and diffed when it changes, rather than sitting inside a
  page's markup.
- A test asserting the panel copy contains none of the forbidden words, so a
  later edit that reintroduces "soon" fails rather than ships.

Nothing is built. Say the word on the wording and it goes in with the tabs.
