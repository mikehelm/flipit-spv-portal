/**
 * The addresses media is served from. BUILD_SPEC §13.2, §13.3, §18.1.
 *
 * Every one of these goes through the base path, because the application runs
 * under `/SPV` before it runs at a domain root and a hard-coded `/media/…`
 * would break silently on the way. One place to build them means one place to
 * be wrong.
 *
 * `mediaUrl` is deliberately root-relative rather than absolute: an image on
 * an admin screen or a portal page should be fetched from wherever the page
 * was served. `absoluteMediaUrl` exists for the one case that cannot be
 * relative — an image inside an email, which is read in a client that has no
 * idea where it came from.
 */

import { env } from '@/lib/env'

export function mediaUrl(storageKey: string): string {
  return `${env().BASE_PATH}/media/${storageKey}`
}

/** For an email body. §18.1's guard is what stops one being issued from the wrong deployment. */
export function absoluteMediaUrl(storageKey: string): string {
  return `${env().APP_URL.replace(/\/+$/, '')}/media/${storageKey}`
}

export function portalVideoUrl(videoId: string): string {
  return `${env().BASE_PATH}/portal/video/${videoId}`
}

export function adminVideoPreviewUrl(videoId: string): string {
  return `${env().BASE_PATH}/admin/video/${videoId}/preview`
}

export const VIDEO_UPLOAD_PATH = '/admin/video/upload'

export function videoUploadUrl(): string {
  return `${env().BASE_PATH}${VIDEO_UPLOAD_PATH}`
}
