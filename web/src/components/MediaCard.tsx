import { memo, useState } from "react";
import type { MetaPreview } from "../api/types";

interface Props {
  meta: MetaPreview;
  onOpen: (meta: MetaPreview) => void;
  progress?: number;
  landscape?: boolean;
}

export const MediaCard = memo(function MediaCard({ meta, onOpen, progress, landscape }: Props) {
  const [failed, setFailed] = useState(false);
  const poster = landscape ? meta.background ?? meta.poster : meta.poster ?? meta.background;
  return (
    <button
      className={`card ${landscape ? "card-landscape" : ""}`}
      onClick={() => onOpen(meta)}
      title={meta.name}
      type="button"
    >
      <div className="card-art">
        {poster && !failed ? (
          <img loading="lazy" src={poster} alt="" onError={() => setFailed(true)} />
        ) : (
          <div className="card-fallback">{meta.name}</div>
        )}
        {meta.imdbRating && <span className="card-rating">★ {meta.imdbRating}</span>}
        {progress !== undefined && progress > 0 && (
          <span className="card-progress">
            <span style={{ width: `${Math.min(100, progress * 100)}%` }} />
          </span>
        )}
      </div>
      <div className="card-title">{meta.name}</div>
      {meta.releaseInfo && <div className="card-sub">{meta.releaseInfo}</div>}
    </button>
  );
});
