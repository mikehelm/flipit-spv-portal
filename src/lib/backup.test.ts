import { describe, expect, it } from 'vitest'
import { backupFileName, redactUrl } from '../../scripts/backup'

/**
 * The two pure parts of the backup script. CODEX_TASKS WP20.
 *
 * `redactUrl` is the one that matters. A connection string carries a password,
 * the backup script prints where it read from and where it wrote to, and
 * checklist point 8 says no log line carries a credential. A backup run at
 * three in the morning is exactly the log somebody pastes into a chat window
 * asking for help.
 */

describe('a printed connection string never carries its password', () => {
  it('replaces the password and keeps everything useful', () => {
    const redacted = redactUrl('postgresql://spv:s3cr3t-p4ss@db.example.com:5432/spv')
    expect(redacted).not.toContain('s3cr3t-p4ss')
    expect(redacted).toContain('db.example.com')
    expect(redacted).toContain('/spv')
    expect(redacted).toContain('spv:***@')
  })

  it('leaves a passwordless URL alone', () => {
    expect(redactUrl('postgresql://postgres@127.0.0.1:5433/spv')).toContain('127.0.0.1:5433')
  })

  it('says nothing at all about a string it cannot parse', () => {
    // Rather than guessing which part is the secret and printing the rest.
    const redacted = redactUrl('host=db user=spv password=s3cr3t')
    expect(redacted).not.toContain('s3cr3t')
    expect(redacted).toBe('(unparseable connection string)')
  })

  it('handles a password containing URL-significant characters', () => {
    const redacted = redactUrl('postgresql://u:p%40ss%3Aword@h/db')
    expect(redacted).not.toContain('p%40ss')
    expect(redacted).not.toContain('ss:word')
  })
})

describe('the backup filename', () => {
  it('sorts chronologically as a string and contains no colon', () => {
    const early = backupFileName(new Date('2026-03-01T09:05:00.000Z'))
    const later = backupFileName(new Date('2026-03-01T09:06:00.000Z'))

    expect(early < later).toBe(true)
    // Colons are legal on Linux and not on Windows, and a backup filename that
    // cannot be copied to a laptop is a backup somebody will not copy.
    expect(early).not.toContain(':')
    expect(early).toMatch(/^spv-.*\.dump$/)
  })
})
