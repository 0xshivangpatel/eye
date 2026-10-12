// Rewrites HLS playlists so every URI they reference is fetched through this
// server's /proxy route. Browsers need this for streams that lack CORS headers
// or that require specific request headers (common with IPTV).

export function proxiedUrl(proxyBase: string, target: string, headers?: Record<string, string>): string {
  const params = new URLSearchParams({ url: target });
  if (headers && Object.keys(headers).length) params.set("headers", JSON.stringify(headers));
  return `${proxyBase}?${params.toString()}`;
}

const URI_ATTR_RE = /URI="([^"]+)"/g;

export function isHlsPlaylist(contentType: string | null, url: string, firstBytes: string): boolean {
  if (contentType && /mpegurl/i.test(contentType)) return true;
  if (/\.m3u8(\?|$)/i.test(url)) return firstBytes.trimStart().startsWith("#EXTM3U");
  return firstBytes.trimStart().startsWith("#EXTM3U");
}

export function rewritePlaylist(
  body: string,
  playlistUrl: string,
  proxyBase: string,
  headers?: Record<string, string>,
): string {
  const resolve = (ref: string) => new URL(ref, playlistUrl).toString();
  return body
    .split(/\r?\n/)
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed.startsWith("#")) {
        // Tags such as EXT-X-KEY, EXT-X-MEDIA and EXT-X-MAP carry URIs in attributes.
        return line.replace(URI_ATTR_RE, (_m, ref: string) => `URI="${proxiedUrl(proxyBase, resolve(ref), headers)}"`);
      }
      return proxiedUrl(proxyBase, resolve(trimmed), headers);
    })
    .join("\n");
}
