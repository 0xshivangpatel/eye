// Stremio add-on protocol client. An add-on is a static JSON API rooted at a
// manifest.json; resources are fetched by convention:
//   {base}/catalog/{type}/{id}[/{extra}].json
//   {base}/meta/{type}/{id}.json
//   {base}/stream/{type}/{id}.json
//   {base}/subtitles/{type}/{id}[/{extra}].json
import type { AddonDescriptor, CatalogDefinition, Manifest, MetaDetail, MetaPreview, Stream, Subtitle } from "./types";

export class AddonError extends Error {}

function manifestBase(transportUrl: string): string {
  return transportUrl.replace(/\/manifest\.json.*$/i, "");
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new AddonError(`HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

/** Normalize a user-entered add-on URL (stremio://, trailing slash, bare host). */
export function normalizeTransportUrl(input: string): string {
  let url = input.trim();
  url = url.replace(/^stremio:\/\//i, "https://");
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  if (!/manifest\.json/i.test(url)) url = `${url.replace(/\/+$/, "")}/manifest.json`;
  return url;
}

export async function fetchManifest(transportUrl: string, signal?: AbortSignal): Promise<AddonDescriptor> {
  const url = normalizeTransportUrl(transportUrl);
  const manifest = await getJson<Manifest>(url, signal);
  if (!manifest || typeof manifest.id !== "string") throw new AddonError("Not a valid add-on manifest");
  return { transportUrl: url, manifest };
}

function supportsResource(manifest: Manifest, resource: string, type: string, id?: string): boolean {
  return manifest.resources.some((r) => {
    if (typeof r === "string") return r === resource && manifest.types.includes(type);
    if (r.name !== resource) return false;
    if (r.types && !r.types.includes(type)) return false;
    if (id && r.idPrefixes && !r.idPrefixes.some((p) => id.startsWith(p))) return false;
    return true;
  });
}

export function encodeExtra(extra: Record<string, string | number | undefined>): string {
  const parts = Object.entries(extra)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.join("&");
}

export async function fetchCatalog(
  addon: AddonDescriptor,
  catalog: CatalogDefinition,
  extra: Record<string, string | number | undefined> = {},
  signal?: AbortSignal,
): Promise<MetaPreview[]> {
  const base = manifestBase(addon.transportUrl);
  const encoded = encodeExtra(extra);
  const suffix = encoded ? `/${encoded}` : "";
  const url = `${base}/catalog/${catalog.type}/${encodeURIComponent(catalog.id)}${suffix}.json`;
  const data = await getJson<{ metas?: MetaPreview[] }>(url, signal);
  return data.metas ?? [];
}

export async function fetchMeta(addon: AddonDescriptor, type: string, id: string, signal?: AbortSignal): Promise<MetaDetail | null> {
  if (!supportsResource(addon.manifest, "meta", type, id)) return null;
  const base = manifestBase(addon.transportUrl);
  const data = await getJson<{ meta?: MetaDetail }>(`${base}/meta/${type}/${encodeURIComponent(id)}.json`, signal);
  return data.meta ?? null;
}

export async function fetchStreams(addon: AddonDescriptor, type: string, id: string, signal?: AbortSignal): Promise<Stream[]> {
  if (!supportsResource(addon.manifest, "stream", type, id)) return [];
  const base = manifestBase(addon.transportUrl);
  try {
    const data = await getJson<{ streams?: Stream[] }>(`${base}/stream/${type}/${encodeURIComponent(id)}.json`, signal);
    return (data.streams ?? []).map((s) => ({ ...s, name: s.name ?? addon.manifest.name }));
  } catch {
    return [];
  }
}

export async function fetchSubtitles(addon: AddonDescriptor, type: string, id: string, extra: Record<string, string> = {}, signal?: AbortSignal): Promise<Subtitle[]> {
  if (!supportsResource(addon.manifest, "subtitles", type, id)) return [];
  const base = manifestBase(addon.transportUrl);
  const encoded = encodeExtra(extra);
  const suffix = encoded ? `/${encoded}` : "";
  try {
    const data = await getJson<{ subtitles?: Subtitle[] }>(`${base}/subtitles/${type}/${encodeURIComponent(id)}${suffix}.json`, signal);
    return data.subtitles ?? [];
  } catch {
    return [];
  }
}

/** Query many add-ons for streams at once, tagging each with its source name. */
export async function aggregateStreams(
  addons: AddonDescriptor[],
  type: string,
  id: string,
  signal?: AbortSignal,
): Promise<Array<Stream & { addonName: string }>> {
  const results = await Promise.all(
    addons.map(async (addon) => (await fetchStreams(addon, type, id, signal)).map((s) => ({ ...s, addonName: addon.manifest.name }))),
  );
  return results.flat();
}
