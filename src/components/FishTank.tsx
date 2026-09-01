import { Fish, Sprout } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Station } from "../../shared/game";

type PopulationChange = {
  id: number;
  delta: number;
};

export function FishTank({
  station,
  index = 0,
  revealPopulation = true,
  displayMode,
  compact = false,
}: {
  station: Station;
  index?: number;
  revealPopulation?: boolean;
  displayMode?: "hidden" | "qualitative" | "exact";
  compact?: boolean;
}) {
  const previousPopulation = useRef(station.population);
  const [change, setChange] = useState<PopulationChange | null>(null);
  const ratio = station.carryingCapacity
    ? station.population / station.carryingCapacity
    : 0;
  const mode = displayMode ?? (revealPopulation ? "exact" : "hidden");
  const revealsStock = mode !== "hidden";
  const revealsCount = mode === "exact";
  const visibleFish = revealsStock
    ? station.population === 0
      ? 0
      : Math.max(1, Math.round(ratio * 28))
    : 12;
  const condition = ratio > 0.65 ? "healthy" : ratio > 0.3 ? "strained" : "critical";

  useEffect(() => {
    const delta = station.population - previousPopulation.current;
    previousPopulation.current = station.population;
    if (delta === 0) return;

    const nextChange = { id: Date.now(), delta };
    setChange(nextChange);
    const timeout = window.setTimeout(() => {
      setChange((current) => current?.id === nextChange.id ? null : current);
    }, 1150);
    return () => window.clearTimeout(timeout);
  }, [station.population]);

  return (
    <section
      className={`fish-tank fish-tank-${index % 4} ${compact ? "fish-tank-compact" : ""} ${station.population === 0 ? "fish-tank-depleted" : ""} ${change ? change.delta > 0 ? "fish-tank-gaining" : "fish-tank-losing" : ""}`}
      aria-label={
        revealsCount
          ? `${station.name}: ${station.population} of ${station.carryingCapacity} fish`
          : station.name
      }
    >
      <div className="tank-water" aria-hidden="true">
        {Array.from({ length: visibleFish }, (_, fishIndex) => (
          <Fish
            key={fishIndex}
            className="swimming-fish"
            style={
              {
                "--fish-x": `${7 + ((fishIndex * 31 + index * 17) % 84)}%`,
                "--fish-y": `${14 + ((fishIndex * 23 + index * 11) % 68)}%`,
                "--fish-delay": `${-((fishIndex * 0.37) % 4.8)}s`,
                "--fish-scale": `${0.7 + (fishIndex % 4) * 0.12}`,
              } as React.CSSProperties
            }
          />
        ))}
        {change && (
          <div className={`tank-change tank-change-${change.delta > 0 ? "growth" : "catch"}`} key={change.id} aria-hidden="true">
            <span className="tank-change-school">
              {change.delta > 0 ? <Sprout size={23} /> : <><Fish size={20} /><Fish size={17} /><Fish size={14} /></>}
            </span>
            <strong>{revealsCount ? `${change.delta > 0 ? "+" : "−"}${Math.abs(change.delta)}` : change.delta > 0 ? "+" : "−"}</strong>
            <span>{change.delta > 0 ? "replenished" : "caught"}</span>
          </div>
        )}
        {revealsStock && station.population === 0 && <span className="empty-water">Depleted</span>}
      </div>
      <footer className="tank-label">
        <div>
          <strong>{station.name}</strong>
          <span className={`condition condition-${revealsStock ? condition : "unknown"}`}>
            {revealsStock ? condition : "unknown"}
          </span>
        </div>
        {revealsCount && (
          <div className="tank-count">
            <strong>{station.population}</strong>
            <span>of {station.carryingCapacity}</span>
          </div>
        )}
      </footer>
    </section>
  );
}
