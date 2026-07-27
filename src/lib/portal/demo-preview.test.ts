import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { johnDoeDemoPortalView } from './demo'

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('John Doe investor preview', () => {
  it('is useful fake data and never a database row', () => {
    const view = johnDoeDemoPortalView()

    expect(view).toMatchObject({
      accountId: 'demo-john-doe',
      name: 'John Doe',
      email: 'johndoe@gmail.com',
      status: 'ACTIVE',
    })
    expect(view.offers).toHaveLength(1)
    expect(view.offers[0]).toMatchObject({
      proposedAmount: 'USD 5,000.00',
      responseChoice: 'INTERESTED',
      stage: 'RESPONSE_RECORDED',
    })

    const source = read('src/lib/portal/demo.ts')
    expect(source).not.toMatch(/from ['"]@\/db|db\.(insert|update|delete)/)
    expect(source).not.toMatch(
      /from ['"]@\/actions|@\/lib\/email|@\/lib\/portal\/session/,
    )
  })

  it('is protected by an acting-admin guard before its data is selected', () => {
    const portal = read('src/app/portal/page.tsx')
    const previewBranch = portal.slice(
      portal.indexOf('if (isDemoPreview)'),
      portal.indexOf('} else {', portal.indexOf('if (isDemoPreview)')),
    )

    expect(previewBranch).toContain('await requireAdmin()')
    expect(previewBranch.indexOf('await requireAdmin()')).toBeLessThan(
      previewBranch.indexOf('johnDoeDemoPortalView()'),
    )
  })

  it('does not expose the switch to a read-only viewer', () => {
    const layout = read('src/app/(admin)/layout.tsx')
    expect(layout).toContain("admin.role !== 'VIEWER'")
    expect(layout).toContain('<PortalPreviewSwitch mode="ADMIN" />')
  })

  it('keeps every investor mutation disabled in preview mode', () => {
    const portal = read('src/app/portal/page.tsx')
    expect(portal).toContain('allowResponse={!isDemoPreview && canRespond(view.access)}')
    expect(portal).toContain(
      "canChange={!isDemoPreview && view.access.capability === 'FULL'}",
    )
    expect(portal).toContain('Demo preview — no investor session has been created.')
  })

  it('keeps account controls explicit while the unapproved curl stays outside the release', () => {
    const portal = read('src/app/portal/page.tsx')
    const admin = read('src/app/(admin)/layout.tsx')
    const switcher = read('src/components/portal-preview-switch.tsx')

    expect(portal).not.toContain('<AccountCurlMenu')
    expect(admin).not.toContain('<AccountCurlMenu')
    expect(portal).toContain('portalSignOutAction')
    expect(admin).toContain('signOutAction')
    expect(switcher).toContain('fixed bottom-4 left-14')
    expect(switcher).toContain("'-translate-x-2 opacity-25'")
  })

  it('uses a static guarded path rather than putting identity in a query string', () => {
    const route = read('src/app/portal/demo/page.tsx')
    const switcher = read('src/components/portal-preview-switch.tsx')
    expect(route).toContain('renderPortalPage(true)')
    expect(switcher).toContain('JOHN_DOE_PREVIEW_PATH')
    expect(switcher).not.toContain('preview=')
  })
})
