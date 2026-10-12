import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import type { MetaPreview } from "./api/types";
import { DetailModal } from "./components/DetailModal";

interface UIValue {
  openDetail: (meta: MetaPreview) => void;
}

const UIContext = createContext<UIValue | null>(null);

export function UIProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<MetaPreview | null>(null);
  const openDetail = useCallback((m: MetaPreview) => setMeta(m), []);
  const value = useMemo(() => ({ openDetail }), [openDetail]);
  return (
    <UIContext.Provider value={value}>
      {children}
      {meta && <DetailModal meta={meta} onClose={() => setMeta(null)} />}
    </UIContext.Provider>
  );
}

export function useUI(): UIValue {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error("useUI must be used within UIProvider");
  return ctx;
}
