import { useEffect, useState } from "react";
import { useStore } from "../store";
import { useUI } from "../ui";
import { fetchCatalog } from "../api/addons";
import { MediaCard } from "../components/MediaCard";
import type { MetaPreview } from "../api/types";

export function Search() {
  const store = useStore();
  const ui = useUI();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MetaPreview[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      // Query every add-on catalog that advertises `search`.
      const jobs = store.addons.flatMap((addon) =>
        addon.manifest.catalogs
          .filter((c) => c.extraSupported?.includes("search") || c.extra?.some((e) => e.name === "search"))
          .map((c) => fetchCatalog(addon, c, { search: q }, controller.signal).catch(() => [])),
      );
      void Promise.all(jobs).then((lists) => {
        if (controller.signal.aborted) return;
        const seen = new Set<string>();
        const merged: MetaPreview[] = [];
        for (const item of lists.flat()) {
          const key = `${item.type}:${item.id}`;
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push(item);
        }
        setResults(merged);
        setLoading(false);
      });
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, store.addons]);

  return (
    <div className="page page-pad">
      <input
        className="search-input"
        autoFocus
        placeholder="Search movies and series…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading && <div className="muted">Searching…</div>}
      <div className="grid">
        {results.map((m) => (
          <MediaCard key={`${m.type}:${m.id}`} meta={m} onOpen={ui.openDetail} />
        ))}
      </div>
      {!loading && query.trim().length >= 2 && results.length === 0 && <div className="muted">No results.</div>}
    </div>
  );
}
