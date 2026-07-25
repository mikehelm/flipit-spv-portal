import { PageCurl } from '@/components/page-curl'
import { loadAttribution, type AttributionSurface } from '@/lib/attribution'

/**
 * The footer of a screen — BUILD_SPEC §13.2.
 *
 * Two things live here and they are in the order §13.2 asks for: the legal
 * notice, and *below it* the maker's credit. The credit is small, dimmed, has
 * no logo, no colour and no animation, and it can be switched off for either
 * surface independently.
 *
 * The page curl sits beside the FLIPIT wordmark rather than beside the credit —
 * §13.2 wants "no logo competing with FLIPIT's", and putting a brand mark next
 * to somebody else's name is the competition it is warning about.
 *
 * A server component: it reads configuration, so it must be. Rendered inside
 * the admin layout and the investor portal, and nowhere else — see
 * `attribution.test.ts` for why those are the only two.
 */
export async function SiteFooter({
  surface,
  notice,
}: {
  surface: AttributionSurface
  notice?: string
}) {
  const attribution = await loadAttribution(surface)

  return (
    <footer className="mt-12 border-t hairline px-5 py-6 text-[11px] leading-relaxed text-muted">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-3">
        <div className="flex items-center gap-2">
          <PageCurl size={18} />
          <span className="text-[11px] font-bold uppercase tracking-[0.22em] text-dim">
            Flipit
          </span>
        </div>

        {notice ? <p className="max-w-2xl">{notice}</p> : null}

        {attribution.show ? (
          attribution.href ? (
            <p>
              {/*
                "Optionally a link, opening in a new tab, but never styled to
                draw the eye." So: the same size, the same colour, and the same
                weight as the plain text — the only difference is that it is
                clickable. `noopener` because it opens in a new tab; `nofollow`
                because a securities portal should not be passing ranking to
                anybody.
              */}
              <a
                href={attribution.href}
                target="_blank"
                rel="noopener noreferrer nofollow"
                className="text-muted underline-offset-2 hover:underline"
              >
                {attribution.text}
              </a>
            </p>
          ) : (
            <p>{attribution.text}</p>
          )
        ) : null}
      </div>
    </footer>
  )
}
