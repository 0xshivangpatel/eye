import { NavLink, Route, HashRouter, Routes, useNavigate } from "react-router-dom";
import { StoreProvider } from "./store";
import { PlayerProvider } from "./player";
import { UIProvider } from "./ui";
import { Home } from "./pages/Home";
import { Search } from "./pages/Search";
import { Library } from "./pages/Library";
import { LiveTV } from "./pages/LiveTV";
import { Settings } from "./pages/Settings";
import { Party } from "./pages/Party";

function TopNav() {
  const navigate = useNavigate();
  return (
    <header className="topnav">
      <button className="brand" onClick={() => navigate("/")} type="button">
        <span className="brand-mark">▶</span> Marquee
      </button>
      <nav className="nav-links">
        <NavLink to="/" end>
          Home
        </NavLink>
        <NavLink to="/search">Search</NavLink>
        <NavLink to="/live">Live TV</NavLink>
        <NavLink to="/library">Library</NavLink>
        <NavLink to="/party">Watch Together</NavLink>
      </nav>
      <NavLink to="/settings" className="nav-settings" aria-label="Settings">
        ⚙
      </NavLink>
    </header>
  );
}

export default function App() {
  return (
    <HashRouter>
      <StoreProvider>
        <PlayerProvider>
          <UIProvider>
            <TopNav />
            <main className="app-main">
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/search" element={<Search />} />
                <Route path="/live" element={<LiveTV />} />
                <Route path="/library" element={<Library />} />
                <Route path="/party" element={<Party />} />
                <Route path="/party/:code" element={<Party />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Home />} />
              </Routes>
            </main>
          </UIProvider>
        </PlayerProvider>
      </StoreProvider>
    </HashRouter>
  );
}
