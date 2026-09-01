import { ArrowRight, Sprout } from "lucide-react";
import type { GameSettings, Station, Village } from "../../shared/game";
import { predictPopulation } from "../gameMath";

export function GrowthPreview({
  stations,
  settings,
  villages = [],
}: {
  stations: Station[];
  settings: GameSettings;
  villages?: Village[];
}) {
  return (
    <div className="growth-preview">
      <header>
        <Sprout size={18} />
        <div>
          <strong>Next replenishment</strong>
          <span>
            {settings.growthModel === "none"
              ? "No fish return between seasons"
              : settings.growthModel === "multiplier"
              ? `Current stock multiplied by ${settings.reproductionRate}`
              : `Growth slows as each station approaches capacity`}
          </span>
        </div>
      </header>
      <div className="growth-rows">
        {stations.map((station) => {
          const next = predictPopulation(station, settings);
          const growth = next - station.population;
          const village = villages.find((item) => item.id === station.villageId);
          return (
            <div className="growth-row" key={station.id}>
              <span>{villages.length > 1 ? `${village?.name} · ${station.name}` : station.name}</span>
              <strong>{station.population}</strong>
              <ArrowRight size={15} />
              <strong>{next}</strong>
              <em className={growth > 0 ? "positive" : "neutral"}>
                {growth > 0 ? `+${growth}` : growth}
              </em>
            </div>
          );
        })}
      </div>
    </div>
  );
}
