export interface YouTubeVideoUrl {
  /** Always `https://www.youtube.com/watch?v=<id>`, with no playlist or tracking parameters. */
  readonly url: string;
  readonly videoId: string;
}

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
]);
const SHORT_HOST = 'youtu.be';
/** Optional http(s) scheme, then host, path, query and fragment. No whitespace anywhere. */
const URL_SHAPE = /^(?:(https?):\/\/)?([^/?#\s]+)(\/[^?#\s]*)?(\?[^#\s]*)?(#\S*)?$/i;
/** `/shorts/<id>` and `/live/<id>`, with an optional trailing slash. */
const PATH_ID = /^\/(?:shorts|live)\/([^/]+)\/?$/;

function idFromQuery(query: string | undefined): string | null {
  if (query === undefined) return null;
  for (const pair of query.slice(1).split('&')) {
    if (pair.startsWith('v=')) return pair.slice(2);
  }
  return null;
}

function videoIdOf(host: string, path: string, query: string | undefined): string | null {
  if (host === SHORT_HOST) return /^\/([^/]+)\/?$/.exec(path)?.[1] ?? null;
  if (!YOUTUBE_HOSTS.has(host)) return null;
  if (path === '/watch' || path === '/watch/') return idFromQuery(query);
  return PATH_ID.exec(path)?.[1] ?? null;
}

/**
 * Reads a pasted YouTube video link: `watch?v=`, `youtu.be/<id>`, `shorts/<id>`, `live/<id>` on
 * the www, m and music hosts. The scheme may be left out but must be http or https when present.
 * Anything else (other hosts, playlists with no video, ports, user info) is `null`. Pure string
 * parsing, so the renderer can use it too.
 */
export function parseYouTubeUrl(text: string): YouTubeVideoUrl | null {
  const match = URL_SHAPE.exec(text.trim());
  if (match === null) return null;
  const host = (match[2] ?? '').toLowerCase();
  const videoId = videoIdOf(host, match[3] ?? '/', match[4]);
  if (videoId === null || !VIDEO_ID.test(videoId)) return null;
  return { url: `https://www.youtube.com/watch?v=${videoId}`, videoId };
}
