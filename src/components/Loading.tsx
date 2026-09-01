import { Fish } from "lucide-react";

export function Loading({ message = "Connecting to the game" }: { message?: string }) {
  return (
    <div className="loading-screen">
      <Fish className="loading-fish" size={34} />
      <p>{message}</p>
    </div>
  );
}

export function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="loading-screen error-screen">
      <strong>Unable to open the game</strong>
      <p>{message}</p>
      <a className="text-button" href="/">Return home</a>
    </div>
  );
}
