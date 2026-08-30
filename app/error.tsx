"use client";

import { useEffect } from "react";
import { reportClientError } from "./lib/telemetry-client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => reportClientError("render", error), [error]);

  return (
    <main className="fatal-error">
      <div>
        <h1>Wizzy hit a snag.</h1>
        <p>Your wallet and positions are safe. Reload this view to try again.</p>
        <button type="button" onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
