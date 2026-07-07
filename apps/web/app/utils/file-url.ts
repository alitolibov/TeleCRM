/**
 * Builds URL for downloading a Telegram file through our API.
 *
 * Prefer the message-uuid form (`/files/m/<msg-id>`) — the URL is a stable
 * pointer at the DB row, so healing content in place doesn't require a
 * different URL, and browser cache from before the fileId→remoteFileId
 * fixes doesn't overlap with new-scheme requests. Falls back to the legacy
 * `/files/<fileId>?r=&t=` for callers that only have TDLib primitives
 * (Favorites uploads, forward-picker previews, etc.).
 */
export function buildFileUrl(
  apiUrl: string,
  fileId: number,
  remoteFileId?: string,
  contentType?: string,
  messageId?: string,
): string {
  if (messageId) return `${apiUrl}/files/m/${messageId}`
  const params = new URLSearchParams()
  if (remoteFileId) params.set('r', remoteFileId)
  if (contentType) params.set('t', contentType)
  const qs = params.toString()
  return qs ? `${apiUrl}/files/${fileId}?${qs}` : `${apiUrl}/files/${fileId}`
}
