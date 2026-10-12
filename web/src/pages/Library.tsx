import { useStore } from "../store";
import { useUI } from "../ui";
import { MediaCard } from "../components/MediaCard";

export function Library() {
  const store = useStore();
  const ui = useUI();
  const continueItems = store.progress.slice().sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="page page-pad">
      <h1 className="page-h1">Library</h1>
      {continueItems.length > 0 && (
        <>
          <h2 className="section-h">Continue watching</h2>
          <div className="grid">
            {continueItems.map((p) => (
              <MediaCard
                key={`${p.id}:${p.videoId ?? ""}`}
                meta={{ id: p.id, type: p.type, name: p.name, poster: p.poster }}
                onOpen={ui.openDetail}
                progress={p.duration ? p.time / p.duration : 0}
                landscape
              />
            ))}
          </div>
        </>
      )}
      <h2 className="section-h">Saved</h2>
      {store.library.length === 0 ? (
        <div className="muted">Nothing saved yet. Tap “+ Library” on any title.</div>
      ) : (
        <div className="grid">
          {store.library.map((m) => (
            <MediaCard key={`${m.type}:${m.id}`} meta={m} onOpen={ui.openDetail} />
          ))}
        </div>
      )}
    </div>
  );
}
