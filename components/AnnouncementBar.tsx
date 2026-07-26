"use client";

import { useEffect, useState } from "react";

/** Fixed sale deadline so the countdown is deterministic across reloads. */
const SALE_ENDS_AT = new Date("2026-08-01T00:00:00Z").getTime();

function format(remaining: number) {
  if (remaining <= 0) return "0d 00h 00m 00s";
  const s = Math.floor(remaining / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d}d ${pad(h)}h ${pad(m)}m ${pad(s % 60)}s`;
}

export default function AnnouncementBar() {
  // Rendering the ticking value only after mount keeps the server and client
  // markup identical on first paint.
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => setRemaining(SALE_ENDS_AT - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="border-b border-hairline">
      <div className="flex items-center justify-center px-6 py-2.5">
        <p className="text-[13px] text-ink">
          Summer Sale Ends In:{" "}
          <span suppressHydrationWarning>
            {remaining === null ? "—" : format(remaining)}
          </span>
        </p>
      </div>
    </div>
  );
}
