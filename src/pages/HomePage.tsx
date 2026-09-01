import { ArrowRight, MonitorUp, Smartphone } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Brand } from "../components/Brand";

export function HomePage() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  const join = (event: React.FormEvent) => {
    event.preventDefault();
    const cleanCode = code.trim().toUpperCase();
    if (cleanCode) navigate(`/play/${cleanCode}`);
  };

  return (
    <main className="home-shell">
      <header className="home-header">
        <Brand />
      </header>

      <section className="role-picker" aria-labelledby="choose-role">
        <div className="role-intro">
          <h1 id="choose-role">Commons Fishery</h1>
          <p>A multiplayer Tragedy of the Commons game.</p>
        </div>

        <div className="role-actions">
          <button className="role-action host-action" onClick={() => navigate("/host")}>
            <span className="role-icon"><MonitorUp size={28} /></span>
            <span>
              <strong>Host a game</strong>
              <small>Create and run a session</small>
            </span>
            <ArrowRight size={20} />
          </button>

          <form className="join-action" onSubmit={join}>
            <span className="role-icon"><Smartphone size={27} /></span>
            <label htmlFor="game-code">
              <strong>Join a game</strong>
              <small>Use the facilitator’s code</small>
            </label>
            <div className="join-code-row">
              <input
                id="game-code"
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                placeholder="GAME CODE"
                maxLength={10}
                autoCapitalize="characters"
                required
              />
              <button className="icon-button primary" aria-label="Join game" type="submit">
                <ArrowRight size={20} />
              </button>
            </div>
          </form>
        </div>
      </section>
    </main>
  );
}
