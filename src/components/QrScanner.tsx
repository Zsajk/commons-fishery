import { BrowserQRCodeReader } from "@zxing/browser";
import { Camera, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function QrScanner({
  onScan,
  onClose,
}: {
  onScan: (value: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const reader = new BrowserQRCodeReader();
    let stopped = false;
    let controls: { stop: () => void } | undefined;

    reader
      .decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } } },
        videoRef.current!,
        (result) => {
          if (!stopped && result) {
            stopped = true;
            controls?.stop();
            onScan(result.getText());
          }
        },
      )
      .then((nextControls) => {
        controls = nextControls;
      })
      .catch(() => setError("Camera access is unavailable. Use the on-screen stations instead."));

    return () => {
      stopped = true;
      controls?.stop();
    };
  }, [onScan]);

  return (
    <div className="scanner-overlay" role="dialog" aria-modal="true" aria-label="Scan fishing station">
      <div className="scanner-window">
        <header><Camera size={19} /><strong>Scan a fishing station</strong><button className="icon-button" onClick={onClose} aria-label="Close scanner"><X size={19} /></button></header>
        <div className="camera-frame"><video ref={videoRef} muted playsInline /></div>
        {error && <p className="scanner-error">{error}</p>}
      </div>
    </div>
  );
}
