import { useRef } from "react";
import type { MetaPreview } from "../api/types";
import { MediaCard } from "./MediaCard";

interface Props {
  title: string;
  items: MetaPreview[];
  loading?: boolean;
  accent?: string;
  landscape?: boolean;
  onOpen: (meta: MetaPreview) => void;
  progressFor?: (meta: MetaPreview) => number | undefined;
}

export function Row({ title, items, loading, accent, landscape, onOpen, progressFor }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const nudge = (dir: 1 | -1) => scroller.current?.scrollBy({ left: dir * scroller.current.clientWidth * 0.9, behavior: "smooth" });

  if (!loading && items.length === 0) return null;
  return (
    <section className="row">
      <h2 className="row-title">
        {accent && <span className="row-dot" style={{ background: accent }} />}
        {title}
      </h2>
      <div className="row-wrap">
        <button className="row-arrow left" onClick={() => nudge(-1)} aria-label="Scroll left" type="button">
          ‹
        </button>
        <div className="row-scroller" ref={scroller}>
          {loading
            ? Array.from({ length: 8 }).map((_, i) => <div key={i} className={`card skeleton ${landscape ? "card-landscape" : ""}`} />)
            : items.map((meta) => (
                <MediaCard key={`${meta.id}-${meta.type}`} meta={meta} onOpen={onOpen} landscape={landscape} progress={progressFor?.(meta)} />
              ))}
        </div>
        <button className="row-arrow right" onClick={() => nudge(1)} aria-label="Scroll right" type="button">
          ›
        </button>
      </div>
    </section>
  );
}
