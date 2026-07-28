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

  it('is protected by a signed-in reader guard before its data is selected', () => {
    const portal = read('src/app/portal/page.tsx')
    const previewBranch = portal.slice(
      portal.indexOf('if (isDemoPreview)'),
      portal.indexOf('} else {', portal.indexOf('if (isDemoPreview)')),
    )

    expect(previewBranch).toContain('await requireReader()')
    expect(previewBranch.indexOf('await requireReader()')).toBeLessThan(
      previewBranch.indexOf('johnDoeDemoPortalView()'),
    )
  })

  it('exposes the safe view switch to a read-only experience tester', () => {
    const layout = read('src/app/(admin)/layout.tsx')
    expect(layout).toContain('<PortalPreviewSwitch mode="ADMIN" role={admin.role} />')
    expect(layout).not.toContain("admin.role !== 'VIEWER'")
  })

  it('keeps every investor mutation disabled in preview mode', () => {
    const portal = read('src/app/portal/page.tsx')
    expect(portal).toContain('allowResponse={!isDemoPreview && canRespond(view.access)}')
    expect(portal).toContain(
      "canChange={!isDemoPreview && view.access.capability === 'FULL'}",
    )
    expect(portal).toContain('Demo preview — no investor session has been created.')
  })

  it('conceals every account beneath the curl and keeps the rocker low-left', () => {
    const portal = read('src/app/portal/page.tsx')
    const admin = read('src/app/(admin)/layout.tsx')
    const menu = read('src/components/account-curl-menu.tsx')
    const switcher = read('src/components/portal-preview-switch.tsx')

    expect(portal).toContain('<AccountCurlMenu')
    expect(admin).toContain('<AccountCurlMenu')
    expect(menu).toContain('<CurlCorner')
    expect(menu).toContain('data-testid="account-curl-toggle"')
    expect(menu).toContain('!z-20')
    expect(menu).toContain('z-10')
    expect(menu).toContain('opacity-0')
    expect(menu).toContain('onPointerEnter={() => setHovered(true)}')
    expect(menu).toContain('hidden={!visible}')
    expect(menu).toContain("event.key === 'Escape'")
    expect(switcher).toContain('fixed bottom-4 left-14')
    expect(switcher).toContain("'-translate-x-2 opacity-25'")
  })

  it('offers Mike, David and John Doe without putting identity in a query string', () => {
    const route = read('src/app/portal/demo/page.tsx')
    const portal = read('src/app/portal/page.tsx')
    const switcher = read('src/components/portal-preview-switch.tsx')
    expect(route).toContain('renderPortalPage(true)')
    expect(portal).toContain(
      '<PortalPreviewSwitch mode="INVESTOR" role={previewRole} />',
    )
    expect(switcher).toContain('JOHN_DOE_PREVIEW_PATH')
    expect(switcher).toContain("name: 'Mike'")
    expect(switcher).toContain("name: 'David'")
    expect(switcher).toContain("name: 'John Doe'")
    expect(switcher).toContain("name: 'Investor view'")
    expect(switcher).toContain("description: 'Safe John Doe rehearsal'")
    expect(switcher).toContain('usePathname')
    expect(switcher).not.toContain('preview=')
  })

  it('defaults text to 50% above the previous size and keeps a visible hover control on every page', () => {
    const styles = read('src/app/globals.css')
    const control = read('src/components/text-size-control.tsx')
    const rootLayout = read('src/app/layout.tsx')
    const adminLayout = read('src/app/(admin)/layout.tsx')

    expect(styles).toContain('--user-text-scale: 1.5')
    expect(styles).toContain('calc(0.875rem * var(--user-text-scale))')
    expect(control).toContain('const DEFAULT_TEXT_SCALE = 1.5')
    expect(control).toContain("const STORAGE_KEY = 'flipit-text-scale-v2'")
    expect(control).toContain('group-hover:max-w-28')
    expect(control).toContain('group-hover:visible')
    expect(control).toContain('h-11 w-11')
    expect(control).toContain('Make text larger')
    expect(control).toContain('Make text smaller')
    expect(rootLayout).toContain('<TextSizeControl />')
    expect(adminLayout).toContain('max-w-6xl')
  })
})
