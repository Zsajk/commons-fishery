import { useEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { DisplayPage } from "./pages/DisplayPage";
import { HomePage } from "./pages/HomePage";
import { HostPage } from "./pages/HostPage";
import { LeaderboardPage } from "./pages/LeaderboardPage";
import { PlayerPage } from "./pages/PlayerPage";
import { WorkshopLobbyPage } from "./pages/WorkshopLobbyPage";

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, [pathname]);
  return null;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/host" element={<HostPage />} />
        <Route path="/host/:code" element={<HostPage />} />
        <Route path="/play" element={<PlayerPage />} />
        <Route path="/play/:code" element={<PlayerPage />} />
        <Route path="/display/:code" element={<DisplayPage />} />
        <Route path="/leaderboard/:workshopName" element={<LeaderboardPage />} />
        <Route path="/workshop/:workshopName" element={<WorkshopLobbyPage />} />
      </Routes>
    </>
  );
}
