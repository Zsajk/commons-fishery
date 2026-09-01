import { useEffect, useState } from "react";
import type { ActionResult, GameState } from "../shared/game";
import { socket } from "./socket";

export function useGame(code: string | undefined) {
  const [game, setGame] = useState<GameState | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(Boolean(code));

  useEffect(() => {
    if (!code) {
      setLoading(false);
      return;
    }

    const onState = ((nextGame: GameState) => {
      if (nextGame.code === code.toUpperCase()) setGame(nextGame);
    }) as never;
    const subscribe = () => {
      socket.emit("game:subscribe", code, (result: ActionResult<GameState>) => {
        setLoading(false);
        if (result.ok && result.data) {
          setError("");
          setGame(result.data);
        } else {
          setError(result.error ?? "Unable to open this game.");
        }
      });
    };

    socket.on("game:state", onState);
    socket.on("connect", subscribe as never);
    if (socket.connected) subscribe();

    return () => {
      socket.off("game:state", onState);
      socket.off("connect", subscribe as never);
    };
  }, [code]);

  return { game, error, loading };
}
