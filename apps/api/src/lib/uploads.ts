import { randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { FastifyRequest } from 'fastify';
import { AVATAR_MIME_TYPES } from '@trackt/shared';

/**
 * User image uploads (avatars, entry covers — PRD §6.1): streamed to local
 * disk under `UPLOADS_DIR`, served back via `/uploads/`. All images share the
 * avatar constraints (2MB, png/jpeg/webp) enforced by the multipart limits in
 * app.ts plus the mimetype allowlist here.
 */

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export type StoreImageResult = { publicPath: string; error?: never } | { error: string };

/**
 * Stream the request's multipart file to `<UPLOADS_DIR>/<subdir>/<stem>-<rand>.<ext>`.
 * Client mistakes (missing file, bad type, too large) come back as an `error`
 * message for a 400; anything else throws.
 */
export async function storeUploadedImage(
  request: FastifyRequest,
  uploadsDir: string,
  subdir: string,
  stem: string,
): Promise<StoreImageResult> {
  const file = await request.file();
  if (!file) return { error: 'expected a file field' };
  const extension = EXTENSION_BY_MIME[file.mimetype];
  if (!extension) {
    return { error: `unsupported image type — use ${AVATAR_MIME_TYPES.join(', ')}` };
  }

  await mkdir(join(resolve(uploadsDir), subdir), { recursive: true });
  const filename = `${stem}-${randomUUID().slice(0, 8)}.${extension}`;
  const target = join(resolve(uploadsDir), subdir, filename);
  try {
    await pipeline(file.file, createWriteStream(target));
  } catch (error) {
    await unlink(target).catch(() => undefined);
    // @fastify/multipart aborts the stream when the size limit is hit.
    if (file.file.truncated || (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE') {
      return { error: 'image too large — 2MB max' };
    }
    throw error;
  }
  if (file.file.truncated) {
    await unlink(target).catch(() => undefined);
    return { error: 'image too large — 2MB max' };
  }
  return { publicPath: `/uploads/${subdir}/${filename}` };
}

/** Best-effort removal of a stored upload; never touches external URLs. */
export async function removeStoredUpload(
  uploadsDir: string,
  subdir: string,
  publicPath: string | null,
): Promise<void> {
  if (!publicPath?.startsWith(`/uploads/${subdir}/`)) return;
  await unlink(join(resolve(uploadsDir), publicPath.replace('/uploads/', ''))).catch(
    () => undefined,
  );
}
