/**
 * Builds URL for downloading a Telegram file through our API.
 * Pass `remoteFileId` whenever you have it — the API uses it to resolve the
 * stable TDLib remote ID to the current local one (local IDs get reused
 * across worker restarts, leading to wrong files being served otherwise).
 */
export function buildFileUrl(apiUrl: string, fileId: number, remoteFileId?: string): string {
  const base = `${apiUrl}/files/${fileId}`
  return remoteFileId ? `${base}?r=${encodeURIComponent(remoteFileId)}` : base
}
