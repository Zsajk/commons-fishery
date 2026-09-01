import { ExternalLink, Radio } from "lucide-react";
import { Link } from "react-router-dom";
import type { GameState } from "../../shared/game";
import { Brand } from "./Brand";

export function GameHeader({ game, role }: { game: GameState; role: string }) {
  return (
    <header className="app-header">
      <Brand compact />
      <div className="game-identity">
        <span>{role}</span>
        <strong>{game.title}</strong>
      </div>
      <div className="game-code-chip">
        <Radio size={15} />
        <span>{game.code}</span>
      </div>
      <Link className="icon-button" to={`/display/${game.code}`} target="_blank" title="Open projector display">
        <ExternalLink size={18} />
      </Link>
    </header>
  );
}
