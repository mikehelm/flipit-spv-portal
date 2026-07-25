import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  generateMetadata,
  VerificationPageContent,
} from '@/app/verify/page'
import { loadVerificationConfig } from './config'
import { buildVerificationRobotsPolicy } from './robots'

describe('/verify', () => {
  const config = loadVerificationConfig({
    PRODUCTION_APP_URL: 'https://spv.flipit.com',
    VERIFICATION_SENDER_EMAIL: 'configured-sender@example.com',
  })

  it('renders without an authentication dependency and uses configured facts', () => {
    const html = renderToStaticMarkup(
      <VerificationPageContent config={config} />,
    )

    expect(html).toContain('configured-sender@example.com')
    expect(html).toContain('spv.flipit.com')
    expect(html).toContain('Michael Helm')
    expect(html).toContain('David Serene')
    expect(html).toContain('Payment details will NEVER be changed by email')
    expect(html).toContain('verify the instructions by voice')
  })

  it('deliberately opts back into indexing', () => {
    expect(generateMetadata().robots).toMatchObject({
      index: true,
      follow: true,
    })
  })

  it('allows only the verification path in the robots policy', () => {
    expect(buildVerificationRobotsPolicy()).toMatchObject({
      rules: {
        userAgent: '*',
        allow: ['/verify', '/verify/'],
        disallow: '/',
      },
    })
  })

  it('fails closed when the sender is not configured', () => {
    expect(() =>
      loadVerificationConfig({
        PRODUCTION_APP_URL: 'https://spv.flipit.com',
      }),
    ).toThrow()
  })
})
