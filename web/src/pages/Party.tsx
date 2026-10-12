import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { usePlayer, useDisplayName } from "../player";
import { mediaFromWebUrl, mediaFromYouTube } from "../party/shared";
import type { ActiveMedia } from "../components/WatchOverlay";

/**
 * Watch-together lobby. Create a room around a YouTube link, a direct web
 * video, or nothing (then pick a title from the catalog), or join by code.
 * When the route carries a code (/party/:code) the user joins immediately.
 */
export function Party() {
  const player = usePlayer();
  const navigate = useNavigate();
  const { code: routeCode } = useParams();
  const [name, setName] = useDisplayName();
  const [source, setSource] = useState("");
  const [title, setTitle] = useState("");
  const [joinCode, setJoinCode] = useState(routeCode ?? "");
  const [error, setError] = useState<string | null>(null);

  const ensureName = (): string => {
    const n = name.trim() || "Guest";
    if (!name.trim()) setName(n);
    return n;
  };

  const createWith = (media: ActiveMedia | null) => {
    player.startParty(media, ensureName());
    navigate("/");
  };

  const createFromSource = () => {
    setError(null);
    const yt = mediaFromYouTube(source, title);
    const web = yt ? null : mediaFromWebUrl(source, title);
    const media = yt ?? web;
    if (!media) {
      setError("Enter a YouTube link/ID or a direct video URL (mp4, webm, m3u8).");
      return;
    }
    createWith({ ...media });
  };

  const join = () => {
    const c = joinCode.trim().toUpperCase();
    if (c.length < 4) {
      setError("Enter the room code your host shared.");
      return;
    }
    player.joinParty(c, ensureName());
    navigate("/");
  };

  // If arriving via an invite link, offer a one-tap join.
  return (
    <div className="page page-pad party-lobby">
      <h1 className="page-h1">Watch Together</h1>
      <p className="muted">Create a room and share the code. Everyone stays in sync — movies and series, YouTube, or any direct video link.</p>

      <label className="field">
        <span>Your name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
      </label>

      <div className="party-cards">
        <section className="settings-card">
          <h2>Start a room</h2>
          <p className="muted small">Leave the link empty to browse the catalog first, or paste a video to start instantly.</p>
          <input placeholder="YouTube link / ID, or https://…/video.mp4 (optional)" value={source} onChange={(e) => setSource(e.target.value)} />
          <input placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="party-buttons">
            <button className="btn btn-primary" onClick={() => (source.trim() ? createFromSource() : createWith(null))} type="button">
              {source.trim() ? "▶ Start with this video" : "Start an empty room"}
            </button>
          </div>
        </section>

        <section className="settings-card">
          <h2>Join a room</h2>
          <p className="muted small">Enter the 6-character code from your host.</p>
          <input className="code-input" placeholder="ABC123" value={joinCode} maxLength={6} onChange={(e) => setJoinCode(e.target.value.toUpperCase())} />
          <div className="party-buttons">
            <button className="btn btn-primary" onClick={join} type="button">
              Join room
            </button>
          </div>
        </section>
      </div>
      {error && <div className="field-msg">{error}</div>}
      <p className="muted small">
        Tip: inside any movie or show, use the <strong>👥 Party</strong> button on a stream to start watching it together.
      </p>
    </div>
  );
}
