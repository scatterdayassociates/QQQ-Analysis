"use client";

// theta: 0 = left end of the semicircle (score 0), 180 = right end (score 100),
// sweeping clockwise through the top — a small local polar-coordinate helper,
// not a general-purpose one, so it stays inline rather than in a shared util.
function pointAt(cx: number, cy: number, r: number, thetaDeg: number) {
  const standard = ((180 - thetaDeg) * Math.PI) / 180;
  return { x: cx + r * Math.cos(standard), y: cy - r * Math.sin(standard) };
}

function arcPath(cx: number, cy: number, r: number, fromTheta: number, toTheta: number) {
  const start = pointAt(cx, cy, r, fromTheta);
  const end = pointAt(cx, cy, r, toTheta);
  const largeArc = toTheta - fromTheta > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

export default function StrengthGauge({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  const sweep = (clamped / 100) * 180;
  const cx = 110;
  const cy = 96;
  const r = 82;
  const color = clamped >= 70 ? "var(--up)" : clamped <= 30 ? "var(--down)" : "var(--accent-vol)";

  return (
    <svg
      viewBox="0 0 220 112"
      width="100%"
      height="120"
      role="img"
      aria-label={`Aggregate strength ${clamped.toFixed(0)} out of 100`}
    >
      <path d={arcPath(cx, cy, r, 0, 180)} fill="none" stroke="var(--border)" strokeWidth={14} strokeLinecap="round" />
      {sweep > 0 && (
        <path d={arcPath(cx, cy, r, 0, sweep)} fill="none" stroke={color} strokeWidth={14} strokeLinecap="round" />
      )}
      <text
        x={cx}
        y={cy - 8}
        textAnchor="middle"
        fontSize={30}
        fontWeight={700}
        fill="var(--text)"
        className="mono"
      >
        {clamped.toFixed(0)}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" fontSize={11} fill="var(--muted-2)">
        / 100 aggregate
      </text>
    </svg>
  );
}
