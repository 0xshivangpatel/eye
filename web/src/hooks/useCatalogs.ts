import { useEffect, useRef, useState } from "react";
import type { AddonDescriptor, CatalogDefinition, MetaPreview } from "../api/types";
import { fetchCatalog } from "../api/addons";

export interface CatalogRow {
  key: string;
  title: string;
  addon: AddonDescriptor;
  catalog: CatalogDefinition;
  accent?: string;
  items: MetaPreview[];
  loading: boolean;
  error?: string;
}

export interface RowSpec {
  key: string;
  title: string;
  addon: AddonDescriptor;
  catalog: CatalogDefinition;
  extra?: Record<string, string | number>;
  accent?: string;
}

/** Lazily loads each row's items; rows render skeletons until resolved. */
export function useCatalogRows(specs: RowSpec[]): CatalogRow[] {
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const specKey = specs.map((s) => s.key).join("|");
  const specsRef = useRef(specs);
  specsRef.current = specs;

  useEffect(() => {
    const current = specsRef.current;
    setRows(current.map((s) => ({ ...s, items: [], loading: true })));
    const controller = new AbortController();
    current.forEach((spec, index) => {
      void fetchCatalog(spec.addon, spec.catalog, spec.extra ?? {}, controller.signal)
        .then((items) => {
          setRows((prev) => {
            const next = [...prev];
            if (next[index]) next[index] = { ...next[index]!, items, loading: false };
            return next;
          });
        })
        .catch((err: Error) => {
          if (controller.signal.aborted) return;
          setRows((prev) => {
            const next = [...prev];
            if (next[index]) next[index] = { ...next[index]!, loading: false, error: err.message };
            return next;
          });
        });
    });
    return () => controller.abort();
  }, [specKey]);

  return rows;
}
