import { useEffect, useState } from "react";
import type { MetaPreview } from "../api/types";

interface Props {
  items: MetaPreview[];
  onOpen: (meta: MetaPreview) => void;
}

/** Rotating featured banner at the top of the home screen. */
export function Hero({ items, onOpen }: Props) {
  const [index, setIndex] = useState(0);
  const pool = items.filter((m) => m.background).slice(0, 6);

  useEffect(() => {
    if (pool.length <= 1) return;
    const timer = setInterval(() => setIndex((i) => (i + 1) % pool.length), 9000);
    return () => clearInterval(timer);
  }, [pool.length]);

  if (pool.length === 0) return null;
  const meta = pool[index % pool.length]!;
  return (
    <div className="hero" style={{ backgroundImage: `url(${meta.background})` }}>
      <div className="hero-shade" />
      <div className="hero-body">
        {meta.logo ? <img className="hero-logo" src={meta.logo} alt={meta.name} /> : <h1 className="hero-name">{meta.name}</h1>}
        <div className="hero-meta">
          {meta.releaseInfo && <span>{meta.releaseInfo}</span>}
          {meta.imdbRating && <span>★ {meta.imdbRating}</span>}
          {meta.genres?.slice(0, 3).map((g) => (
            <span key={g} className="chip">
              {g}
            </span>
          ))}
        </div>
        {meta.description && <p className="hero-desc">{meta.description}</p>}
        <div className="hero-actions">
          <button className="btn btn-primary" onClick={() => onOpen(meta)} type="button">
            ▶ Play
          </button>
          <button className="btn" onClick={() => onOpen(meta)} type="button">
            More info
          </button>
        </div>
      </div>
      <div className="hero-dots">
        {pool.map((m, i) => (
          <button key={m.id} className={i === index ? "on" : ""} onClick={() => setIndex(i)} aria-label={`Feature ${i + 1}`} type="button" />
        ))}
      </div>
    </div>
  );
}
