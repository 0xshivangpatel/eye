import { useMemo } from "react";
import { useStore } from "../store";
import { useUI } from "../ui";
import { usePlayer } from "../player";
import { useCatalogRows } from "../hooks/useCatalogs";
import { homeRowSpecs } from "../hooks/rowSpecs";
import { Row } from "../components/Row";
import { Hero } from "../components/Hero";
import type { MetaPreview } from "../api/types";

export function Home() {
  const store = useStore();
  const ui = useUI();
  const player = usePlayer();
  const specs = useMemo(() => homeRowSpecs(store.addons), [store.addons]);
  const rows = useCatalogRows(specs);

  const continueItems: MetaPreview[] = store.progress
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map((p) => ({ id: p.id, type: p.type, name: p.name, poster: p.poster }));

  const heroItems = rows.find((r) => r.items.length)?.items ?? [];

  if (store.addonsLoading && rows.every((r) => r.loading)) {
    return (
      <div className="page">
        <Hero items={[]} onOpen={ui.openDetail} />
        <Row title="Loading…" items={[]} loading onOpen={ui.openDetail} />
      </div>
    );
  }

  return (
    <div className="page">
      <Hero items={heroItems} onOpen={ui.openDetail} />
      <div className="rows">
        {continueItems.length > 0 && (
          <Row
            title="Continue watching"
            items={continueItems}
            landscape
            onOpen={(m) => ui.openDetail(m)}
            progressFor={(m) => {
              const p = store.progress.find((x) => x.id === m.id);
              return p && p.duration ? p.time / p.duration : undefined;
            }}
          />
        )}
        {store.library.length > 0 && <Row title="My library" items={store.library} onOpen={ui.openDetail} />}
        {rows.map((r) => (
          <Row key={r.key} title={r.title} items={r.items} loading={r.loading} accent={r.accent} onOpen={ui.openDetail} />
        ))}
        {!store.addonsLoading && rows.length === 0 && (
          <div className="empty">
            <p>No catalogs yet.</p>
            <button className="btn btn-primary" onClick={() => player.close()} type="button">
              Add add-ons in Settings
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
