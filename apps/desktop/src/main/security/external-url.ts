/**
 * The only links the app hands to the operating system: https, a host, no credentials in the
 * address. A renderer that opens a window for anything else (file:, javascript:, http:) is denied.
 */
export function isSafeExternalUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  return (
    url.protocol === 'https:' && url.hostname !== '' && url.username === '' && url.password === ''
  );
}
