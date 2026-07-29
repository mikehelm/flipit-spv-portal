import Link from 'next/link'
import { Card, Notice } from '@/components/admin/ui'
import type { MediaListItem } from '@/actions/media'
import { absoluteMediaUrl, mediaUrl } from '@/lib/media/urls'

/**
 * Library images, on the screen where a template is written. BUILD_SPEC §13.2.
 *
 * §13.2 asks for images "re-usable across the portal, the email templates, and
 * §13.1's roadmap tiles". This is the email-templates half, and it is a list of
 * addresses rather than a button that inserts a variable — which is a decision
 * worth stating, because a variable would have been easier and would have been
 * wrong.
 *
 * **An image in an email must live in the template source, not in a variable.**
 * §8.2's approval is a hash over the template source. If a template said
 * `{{header_image}}` and the image behind it were a setting, somebody could
 * change what every recipient sees without changing the hash — the approval
 * would still be current and would no longer cover the document that went out.
 * Pasting the address in means the approval covers the image, and changing the
 * image changes the hash and requires a fresh approval. That is the correct
 * behaviour and it is what this panel says out loud.
 *
 * The absolute address is the one shown, because an email client has no idea
 * where the message came from. §18.1's guard on `APP_URL` is what stops one
 * being issued from the wrong deployment.
 */
export function TemplateMediaPanel({ images }: { images: MediaListItem[] }) {
  return (
    <Card
      title="Images you can use"
      description="From the media library. Paste an address straight into the template's HTML part."
    >
      {images.length === 0 ? (
        <p className="text-sm leading-relaxed text-dim">
          Nothing in the library yet. The invitation is designed to be legible with images
          blocked, so it is complete without one &mdash;{' '}
          <Link href="/admin/media" className="text-orange underline-offset-4 hover:underline">
            add one
          </Link>{' '}
          if you want a header.
        </p>
      ) : (
        <>
          <ul className="space-y-4">
            {images.map((image) => (
              <li key={image.id} className="border-t hairline pt-4 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="shrink-0 rounded-sm border hairline bg-bg2 p-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={mediaUrl(image.storageKey)}
                      alt={image.description ?? image.name}
                      className="max-h-16 w-auto max-w-32"
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-ftext">{image.name}</p>
                    {image.width && image.height ? (
                      <p className="mt-0.5 text-xs text-muted">
                        {image.width} &times; {image.height}
                      </p>
                    ) : null}
                    <p className="mt-2 break-all font-mono text-xs text-silver2">
                      {absoluteMediaUrl(image.storageKey)}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-5 space-y-3">
            <Notice tone="warn">
              Putting an image in the template <strong>changes the template</strong>, so it
              needs fresh approval before sending unlocks. The approval must cover the
              document that actually goes out, images included.
            </Notice>
            <Notice>
              Use the absolute address exactly as shown. An email client has no idea where the
              message came from, and a relative path will not load. The email must remain
              legible with images blocked, so an image should add to it rather than carry it
              &mdash; give every one a useful text description.
            </Notice>
          </div>
        </>
      )}
    </Card>
  )
}
