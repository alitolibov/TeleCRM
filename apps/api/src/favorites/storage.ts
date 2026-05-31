import { resolve } from 'path'

/**
 * Where uploaded favorites media is stored on disk. Per-user subdirectory
 * makes "clear" / user-delete cleanup a single rmdir. Override with the env
 * var in Docker (mount a volume to a stable path); local dev uses
 * `apps/api/data/favorites/` which is gitignored.
 */
export const FAVORITES_DIR =
  process.env.FAVORITES_DIR ?? resolve(process.cwd(), 'data/favorites')
