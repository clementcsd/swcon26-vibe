import { useEffect, useState } from "react";

function format(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function Timer({ endsAt }: { endsAt: number | null }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  if (!endsAt) return <span className="font-display text-4xl tracking-tight">--:--</span>;
  const left = endsAt - now;
  const urgent = left < 30_000;
  return (
    <span
      className={`font-display text-4xl tracking-tight tabular-nums ${urgent ? "text-hot" : "text-lime"}`}
    >
      {format(left)}
    </span>
  );
}
