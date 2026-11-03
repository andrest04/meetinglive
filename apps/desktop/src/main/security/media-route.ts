import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { APP_HOST, APP_SCHEME } from './trusted-origin';

/** Audio of one meeting is served read-only at vozella://app/media/<meeting id>. */
export const MEDIA_PREFIX = '/media/';

const ID = /^[A-Za-z0-9-]{1,64}$/;

/** The meeting id of a media URL, or null for anything else (foreign, nested or traversing paths). */
export function parseMediaId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return null;
  if (!url.pathname.startsWith(MEDIA_PREFIX)) return null;
  let id: string;
  try {
    id = decodeURIComponent(url.pathname.slice(MEDIA_PREFIX.length));
  } catch {
    return null;
  }
  return ID.test(id) ? id : null;
}

export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

/** One `bytes=` range. Null means serve the whole file; multi-range and other units are ignored. */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  if (header === null) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === '' && match[2] === '')) return null;
  const [, from = '', to = ''] = match;
  let start: number;
  let end: number;
  if (from === '') {
    const length = Number(to);
    if (length === 0) return 'unsatisfiable';
    start = Math.max(0, size - length);
    end = size - 1;
  } else {
    start = Number(from);
    end = to === '' ? size - 1 : Math.min(Number(to), size - 1);
  }
  return start >= size || end < start ? 'unsatisfiable' : { start, end };
}

const AUDIO_MIME: Readonly<Record<string, string>> = {
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.webm': 'audio/webm',
};

const notFound = (): Response => new Response('not found', { status: 404 });

/**
 * Answers a media request with HTTP Range support. The file comes only from `resolveAudio`
 * (the repository record of the meeting), never from the URL.
 */
export async function serveMeetingAudio(
  request: Request,
  resolveAudio: (meetingId: string) => Promise<string | null>,
): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const id = parseMediaId(request.url);
  if (id === null) return notFound();
  let file: string | null;
  let size: number;
  try {
    file = await resolveAudio(id);
    if (file === null) return notFound();
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) return notFound();
    size = stat.size;
  } catch {
    return notFound();
  }
  const headers: Record<string, string> = {
    'Content-Type': AUDIO_MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  };
  const range = parseRange(request.headers.get('Range'), size);
  if (range === 'unsatisfiable') {
    return new Response(null, {
      status: 416,
      headers: { ...headers, 'Content-Range': `bytes */${String(size)}` },
    });
  }
  const { start, end } = range ?? { start: 0, end: size - 1 };
  headers['Content-Length'] = String(end - start + 1);
  if (range) headers['Content-Range'] = `bytes ${String(start)}-${String(end)}/${String(size)}`;
  const status = range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
  return new Response(body, { status, headers });
}
