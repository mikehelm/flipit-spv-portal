/**
 * Who may see the operator's video, and when. BUILD_SPEC §13.3.
 *
 * §13.3 in three sentences, and all three are rules rather than description:
 *
 *   *"He sees it before anyone else does. Preview in the real portal layout,
 *   re-record or replace as many times as he likes, and **nothing is visible
 *   to investors until he explicitly publishes it**."*
 *
 *   *"Video is hosted on the app's own domain, **served only to authenticated
 *   investors**, and never indexed."*
 *
 *   *"The whole feature is optional and removable. **If he never records one,
 *   the portal shows no gap where it would have been.**"*
 *
 * The decision is pure and lives here rather than inside the route, so that
 * the route reads as "ask, then obey" and the rule can be tested without a
 * session, a database or a filesystem.
 */

export type VideoAudience =
  /** A signed-in investor with at least read access to their own record. */
  | 'INVESTOR'
  /** The operator or the owner, looking at the admin preview. */
  | 'ADMIN'
  /** Nobody we know. */
  | 'ANONYMOUS'

export interface VideoVisibilityInput {
  audience: VideoAudience
  /** Null until the operator presses publish. */
  publishedAt: Date | null
  /**
   * Whether the portal is currently readable at all for this viewer — the
   * §4.2 and §7 result the portal page already computes. A suspended account
   * and a disabled service both make this false, and a video is not an
   * exception to either.
   */
  portalReadable: boolean
}

/**
 * The single answer. `false` means 404 — never 403, and never a different
 * 404 from the one an unknown id produces.
 *
 * An admin sees an unpublished video because that is the entire point of the
 * preview; an investor never does. There is no third case and no flag that
 * creates one.
 */
export function mayViewVideo(input: VideoVisibilityInput): boolean {
  if (input.audience === 'ANONYMOUS') return false
  if (input.audience === 'ADMIN') return true
  return input.publishedAt !== null && input.portalReadable
}

/**
 * Whether the portal should render a video section at all.
 *
 * §13.3: "If he never records one, the portal shows no gap where it would have
 * been." So this is not a placeholder, an empty player or a disabled control —
 * when it is false the markup is absent.
 */
export function shouldShowVideoSection(video: { publishedAt: Date | null } | null): boolean {
  return video !== null && video.publishedAt !== null
}

/**
 * The caption shown beside the player.
 *
 * §13.3: *"Include a caption/transcript field. Some recipients will open this
 * somewhere they cannot play sound."* Which means the text is not decoration
 * for the video — for some readers it *is* the video, so it is rendered
 * whenever it exists and is never collapsed behind a control that needs a
 * click.
 */
export function videoTextAlternative(video: {
  caption: string | null
  transcript: string | null
}): { caption: string | null; transcript: string | null; hasText: boolean } {
  const caption = video.caption?.trim() || null
  const transcript = video.transcript?.trim() || null
  return { caption, transcript, hasText: caption !== null || transcript !== null }
}
