import { useEffect, useState } from "react";
import QRCode from "qrcode";

export function QrCode({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState("");

  useEffect(() => {
    QRCode.toDataURL(value, {
      width: 360,
      margin: 1,
      color: { dark: "#17201e", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).then(setSrc);
  }, [value]);

  return (
    <figure className="qr-code">
      {src && <img src={src} alt={`${label} QR code`} />}
      <figcaption>{label}</figcaption>
    </figure>
  );
}
