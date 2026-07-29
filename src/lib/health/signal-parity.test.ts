/**
 * The third surface: whether the thing that pages somebody at three in the
 * morning agrees with the page they will open when they wake up.
 *
 * The health report has three readers, and each of them is a separate place a
 * finding can fail to arrive:
 *
 *   1. the **health page**, which lists everything;
 *   2. the **overview banner**, which carries the subset a page load can afford;
 *   3. the **signal** at `GET /api/health`, which is what an uptime monitor
 *      polls and the only one of the three that survives the machine itself
 *      stopping.
 *
 * `banner-parity.test.ts` compares the first two, and its own header says why:
 * a rule reached the page and never the banner for a year, and *a rule missing
 * from a list looks exactly like a rule that was never written*. Four entries in
 * a row have then recorded the obvious sequel — ***the same trick would work on
 * the signal*** — and nothing has driven it.
 *
 * This is that. It asks two questions the other file does not.
 *
 * ## 1. Is every rule assembled at all?
 *
 * `buildFindings` is a hand-written list of thirteen calls. A rule written,
 * exported and *not added to that list* reaches no surface whatsoever — not the
 * page, not the banner, not the monitor — and every existing parity test passes,
 * because they all compare surfaces against each other and it is on none of
 * them. **That is the omission this repository has actually shipped, one level
 * further up than the one already tested.**
 *
 * Every `*Findings` export is discovered from the module namespace, so a rule
 * added tomorrow is covered the moment it is exported.
 *
 * ## 2. Does the monitor page when, and only when, the page says so?
 *
 * The signal is a reduction, so much of this is true by construction — and "by
 * construction" is the sentence that was also true of the banner comment that
 * turned out to be false for a year. The specific ways it could stop being true:
 * a status derived from something other than the findings; an area dropped by
 * the deduplication; a count that disagrees with the list it counted.
 *
 * Driven across every world in `worlds.ts` rather than over hand-built reports,
 * which is what `signal.test.ts` already does well. The point of doing it again
 * here is that these are the reports the **real rules** produce.
 */

import { describe, expect, it } from 'vitest'

import * as rules from './rules'
import type { Finding, HealthFacts } from './rules'
import { signalStatusCode, summariseHealth } from './signal'
import { CHEAP_WORLDS, dress, EXPENSIVE_WORLDS } from './worlds'

/** Every rule in the module, found rather than listed. The two assemblies excluded. */
const RULES: ReadonlyArray<readonly [string, (facts: HealthFacts) => Finding[]]> = Object.entries(rules)
  .filter(
    ([name, value]) =>
      name.endsWith('Findings') &&
      name !== 'buildFindings' &&
      name !== 'unattendedFindings' &&
      typeof value === 'function',
  )
  .map(([name, value]) => [name, value as (facts: HealthFacts) => Finding[]] as const)

/** Every (cheap, expensive) pair, which is what a report is actually built from. */
const WORLDS: ReadonlyArray<readonly [string, HealthFacts]> = CHEAP_WORLDS.flatMap(
  ([label, cheap]) =>
    EXPENSIVE_WORLDS.map(
      (expensive, index) => [`${label}, world ${index + 1}`, dress(cheap, expensive)] as const,
    ),
)

function reportFor(facts: HealthFacts): { at: Date; findings: Finding[]; worst: Finding['severity'] } {
  const findings = rules.buildFindings(facts)
  return { at: facts.now, findings, worst: rules.worstOf(findings) }
}

function key(finding: Finding): string {
  return `${finding.area}::${finding.headline}::${finding.severity}`
}

describe('what this file is looking at', () => {
  it('found the rules and the worlds, so nothing below can pass over an empty set', () => {
    expect(RULES.length).toBeGreaterThanOrEqual(10)
    expect(WORLDS.length).toBeGreaterThanOrEqual(30)
  })

  it('and those worlds actually produce something that needs a person', () => {
    // Every parity claim below is satisfied by a system in which nothing is
    // ever wrong. This is the control on all of them.
    const wrong = WORLDS.filter(([, facts]) =>
      reportFor(facts).findings.some((finding) => finding.severity === 'WRONG'),
    )
    expect(wrong.length).toBeGreaterThan(5)

    const attention = WORLDS.filter(([, facts]) =>
      reportFor(facts).findings.some((finding) => finding.severity === 'ATTENTION'),
    )
    expect(attention.length).toBeGreaterThan(5)
  })
})

describe('every rule is assembled into the report at all', () => {
  /*
   * The level above the one `banner-parity.test.ts` tests. A rule left out of
   * `buildFindings` is on no surface, and every surface-against-surface
   * comparison agrees about it perfectly.
   */
  for (const [label, facts] of WORLDS) {
    it(`holds when ${label}`, () => {
      const assembled = new Set(rules.buildFindings(facts).map(key))

      for (const [name, rule] of RULES) {
        for (const finding of rule(facts)) {
          expect(
            assembled.has(key(finding)),
            `${name} produces "${finding.headline}" and \`buildFindings\` does not carry it. ` +
              'A rule that is not in that list reaches no surface at all — not the health page, ' +
              'not the overview banner, and not the monitor.',
          ).toBe(true)
        }
      }
    })
  }

  it('and the report contains nothing no rule produced', () => {
    // The other direction. A finding assembled from somewhere other than a
    // discovered rule would be invisible to every check in this file.
    for (const [label, facts] of WORLDS) {
      const fromRules = new Set(RULES.flatMap(([, rule]) => rule(facts)).map(key))
      for (const finding of rules.buildFindings(facts)) {
        expect(fromRules.has(key(finding)), `${label}: "${finding.headline}"`).toBe(true)
      }
    }
  })
})

describe('the monitor pages when, and only when, the page says somebody is needed', () => {
  for (const [label, facts] of WORLDS) {
    it(`holds when ${label}`, () => {
      const report = reportFor(facts)
      const signal = summariseHealth(report)
      const needsAPerson = report.findings.some((finding) => finding.severity === 'WRONG')

      expect(
        signalStatusCode(signal.status) === 503,
        `the page ${needsAPerson ? 'shows' : 'shows no'} WRONG finding and the monitor ` +
          `${signalStatusCode(signal.status) === 503 ? 'pages' : 'does not page'}`,
      ).toBe(needsAPerson)
    })
  }
})

describe('and the signal names every area that is not fine', () => {
  for (const [label, facts] of WORLDS) {
    it(`holds when ${label}`, () => {
      const report = reportFor(facts)
      const signal = summariseHealth(report)

      const named = new Map(signal.areas.map((entry) => [entry.area, entry.severity]))

      for (const finding of report.findings) {
        if (finding.severity === 'OK') continue
        expect(
          named.has(finding.area),
          `the page reports "${finding.headline}" in ${finding.area} and the signal ` +
            'does not name that area at all',
        ).toBe(true)
      }

      // An area carrying both a WRONG and an ATTENTION is named once, as the
      // worse of the two. A monitor told `attention` about an area that also
      // holds a `wrong` is being told the more comfortable half.
      for (const [area, severity] of named) {
        const worstThere = report.findings.some(
          (finding) => finding.area === area && finding.severity === 'WRONG',
        )
          ? 'WRONG'
          : 'ATTENTION'
        expect(severity, `${label}: ${area}`).toBe(worstThere)
      }

      // And nothing invented: every area named is an area with a finding.
      for (const entry of signal.areas) {
        expect(
          report.findings.some(
            (finding) => finding.area === entry.area && finding.severity !== 'OK',
          ),
          `${label}: the signal names ${entry.area} and the page has nothing wrong there`,
        ).toBe(true)
      }
    })
  }
})

describe('and its counts are counts of what the page shows', () => {
  it('in every world', () => {
    for (const [label, facts] of WORLDS) {
      const report = reportFor(facts)
      const signal = summariseHealth(report)

      const tally = {
        wrong: report.findings.filter((finding) => finding.severity === 'WRONG').length,
        attention: report.findings.filter((finding) => finding.severity === 'ATTENTION').length,
        ok: report.findings.filter((finding) => finding.severity === 'OK').length,
      }

      expect(signal.counts, label).toEqual(tally)
      expect(
        signal.counts.wrong + signal.counts.attention + signal.counts.ok,
        `${label}: the counts should account for every finding`,
      ).toBe(report.findings.length)
    }
  })
})

describe('and it still carries nothing about a person', () => {
  it('in every world the real rules produce', () => {
    /*
     * `signal.test.ts` proves this over hand-built findings. Here it is over
     * the reports the rules actually emit, which is where a headline carrying
     * a reminder id or an address would come from. The payload is behind a
     * shared secret held by a third-party monitoring service, which is a weaker
     * thing than a session.
     */
    for (const [label, facts] of WORLDS) {
      const report = reportFor(facts)
      const serialised = JSON.stringify(summariseHealth(report))

      for (const finding of report.findings) {
        expect(serialised.includes(finding.headline), `${label}: headline leaked`).toBe(false)
        if (finding.detail) {
          expect(serialised.includes(finding.detail), `${label}: detail leaked`).toBe(false)
        }
        if (finding.remedy) {
          expect(serialised.includes(finding.remedy), `${label}: remedy leaked`).toBe(false)
        }
      }

      expect(serialised, label).not.toMatch(/@/)
      // Reminder and account ids are uuid-shaped or prefixed; neither belongs
      // in an alert body.
      expect(serialised, label).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i)
      expect(serialised, label).not.toContain('reminder-')
      expect(serialised, label).not.toContain('account-')
    }
  })
})
