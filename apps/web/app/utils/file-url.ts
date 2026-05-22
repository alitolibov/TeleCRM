/**
 * Builds URL for downloading a Telegram file through our API.
 * Pass `remoteFileId` whenever you have it — the API uses it to resolve the
 * stable TDLib remote ID to the current local one (local IDs get reused
 * across worker restarts, leading to wrong files being served otherwise).
 *
 * `contentType` (photo|video|voice|...) is forwarded to TDLib's getRemoteFile
 * via FileType — required to avoid an internal assertion crash for some files.
 */
export function buildFileUrl(
  apiUrl: string,
  fileId: number,
  remoteFileId?: string,
  contentType?: string,
): string {
  const params = new URLSearchParams()
  if (remoteFileId) params.set('r', remoteFileId)
  if (contentType) params.set('t', contentType)
  const qs = params.toString()
  return qs ? `${apiUrl}/files/${fileId}?${qs}` : `${apiUrl}/files/${fileId}`
}
