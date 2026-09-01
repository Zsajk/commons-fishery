import { Anchor, FishSymbol } from "lucide-react";
import { Link } from "react-router-dom";

export function Brand({ compact = false }: { compact?: boolean }) {
  return (
    <Link className="brand" to="/" aria-label="Commons Fishery home">
      <span className="brand-mark" aria-hidden="true">
        <FishSymbol size={compact ? 20 : 24} />
        <Anchor size={compact ? 12 : 14} />
      </span>
      <span>
        <strong>Commons Fishery</strong>
        {!compact && <small>Tragedy of the Commons game</small>}
      </span>
    </Link>
  );
}
