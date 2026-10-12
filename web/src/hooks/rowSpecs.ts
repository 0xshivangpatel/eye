import type { AddonDescriptor } from "../api/types";
import { OTT_ROWS } from "../api/catalogs";
import type { RowSpec } from "./useCatalogs";

/**
 * Build the home-screen rows: branded OTT rows first (Netflix, Disney+, ...),
 * then every remaining catalog each installed add-on advertises.
 */
export function homeRowSpecs(addons: AddonDescriptor[]): RowSpec[] {
  const specs: RowSpec[] = [];
  const used = new Set<string>();

  for (const ott of OTT_ROWS) {
    for (const addon of addons) {
      const catalog = addon.manifest.catalogs.find((c) => c.id === ott.catalogId && c.type === ott.type);
      if (!catalog) continue;
      // Skip catalogs that require an extra value we don't supply (e.g. search).
      if (catalog.extraRequired?.some((e) => e !== "skip" && e !== "genre")) continue;
      const key = `${addon.manifest.id}:${catalog.type}:${catalog.id}:${ott.label}`;
      specs.push({ key, title: ott.label, addon, catalog, accent: ott.accent });
      used.add(`${addon.manifest.id}:${catalog.type}:${catalog.id}`);
    }
  }

  for (const addon of addons) {
    for (const catalog of addon.manifest.catalogs) {
      const id = `${addon.manifest.id}:${catalog.type}:${catalog.id}`;
      if (used.has(id)) continue;
      if (catalog.extraRequired?.some((e) => e !== "skip")) continue;
      used.add(id);
      const title =
        catalog.name && catalog.name.toLowerCase() !== addon.manifest.name.toLowerCase()
          ? `${catalog.name} · ${capitalize(catalog.type)}`
          : `${addon.manifest.name} · ${capitalize(catalog.type)}`;
      specs.push({ key: id, title, addon, catalog });
    }
  }
  return specs;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
