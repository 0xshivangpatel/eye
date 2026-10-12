import { useEffect, useRef, useState } from "react";
import type { useParty } from "../party/useParty";

const REACTIONS = ["😂", "😮", "😍", "👏", "🔥", "😢", "👀", "🎉"];

export function PartyPanel({ party, onClose }: { party: ReturnType<typeof useParty>; onClose: () => void }) {
  const { state } = party;
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"chat" | "people">("chat");
  const chatEnd = useRef<HTMLDivElement>(null);
  const isHost = party.isHost();

  useEffect(() => {
    chatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.chat.length]);

  const inviteLink = state.code ? `${location.origin}/app/#/party/${state.code}` : "";
  const copy = () => void navigator.clipboard?.writeText(inviteLink).catch(() => {});

  return (
    <aside className="party-panel">
      <header className="party-head">
        <div>
          <div className="party-code">Room {state.code ?? "…"}</div>
          <div className="party-status">
            {state.status === "connected" ? `${state.members.length} watching` : state.status}
          </div>
        </div>
        <button className="icon-btn" onClick={onClose} aria-label="Close party" type="button">
          ✕
        </button>
      </header>

      {inviteLink && (
        <button className="invite" onClick={copy} type="button" title="Copy invite link">
          🔗 Copy invite link
        </button>
      )}
      {state.holding.length > 0 && <div className="holding">Waiting for {state.holding.join(", ")}…</div>}

      <div className="party-tabs">
        <button className={tab === "chat" ? "on" : ""} onClick={() => setTab("chat")} type="button">
          Chat
        </button>
        <button className={tab === "people" ? "on" : ""} onClick={() => setTab("people")} type="button">
          People ({state.members.length})
        </button>
      </div>

      {tab === "chat" ? (
        <>
          <div className="chat-log">
            {state.chat.map((m) =>
              m.kind === "system" ? (
                <div key={m.id} className="chat-system">
                  {m.text}
                </div>
              ) : (
                <div key={m.id} className="chat-msg">
                  <span className="chat-author" style={{ color: m.color }}>
                    {m.name}
                  </span>
                  <span className="chat-text">{m.text}</span>
                </div>
              ),
            )}
            <div ref={chatEnd} />
          </div>
          <div className="reactions-bar">
            {REACTIONS.map((e) => (
              <button key={e} onClick={() => party.react(e)} type="button">
                {e}
              </button>
            ))}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              if (draft.trim()) {
                party.chat(draft);
                setDraft("");
              }
            }}
          >
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Message the room…" maxLength={500} />
            <button className="btn btn-primary" type="submit">
              Send
            </button>
          </form>
        </>
      ) : (
        <div className="people-list">
          {state.members.map((m) => (
            <div key={m.id} className="person">
              <span className="person-dot" style={{ background: m.color }} />
              <span className="person-name">
                {m.name}
                {m.id === state.hostId && <span className="tag">host</span>}
                {m.id === state.selfId && <span className="tag">you</span>}
              </span>
              <span className="person-state">{m.buffering ? "buffering" : m.ready ? "ready" : "loading"}</span>
              {isHost && m.id !== state.selfId && (
                <span className="person-actions">
                  <button onClick={() => party.transferHost(m.id)} title="Make host" type="button">
                    ⭐
                  </button>
                  <button onClick={() => party.kick(m.id)} title="Remove" type="button">
                    ✕
                  </button>
                </span>
              )}
            </div>
          ))}
          {isHost && (
            <div className="host-settings">
              <label>
                <input
                  type="checkbox"
                  checked={state.settings.everyoneControls}
                  onChange={(e) => party.updateSettings?.({ everyoneControls: e.target.checked })}
                />
                Everyone can control playback
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={state.settings.waitForAll}
                  onChange={(e) => party.updateSettings?.({ waitForAll: e.target.checked })}
                />
                Wait for everyone when buffering
              </label>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
