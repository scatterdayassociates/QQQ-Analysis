// Eastern-Time helpers for the 0DTE scanner. All cron schedules are written in
// UTC (Vercel cron has no timezone support), so every job re-derives the actual
// ET wall time here and guards itself — this is what keeps the scanner correct
// across the EST/EDT daylight-saving flip without editing vercel.json twice a
// year.

const ET_TIME_ZONE = "America/New_York";

export interface EtNow {
  /** YYYY-MM-DD in ET */
  date: string;
  /** "HH:MM" in ET, 24h */
  hhmm: string;
  /** Minutes since ET midnight */
  minutes: number;
  /** 1 = Monday ... 7 = Sunday */
  isoWeekday: number;
}

export function etFromEpochMs(epochMs: number): EtNow {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(new Date(epochMs)).map((p) => [p.type, p.value]));
  // Intl can emit "24" for midnight with hour12:false in some ICU versions
  const hour = parts.hour === "24" ? "00" : parts.hour;
  const weekdayMap: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${hour}:${parts.minute}`,
    minutes: Number(hour) * 60 + Number(parts.minute),
    isoWeekday: weekdayMap[parts.weekday] ?? 0,
  };
}

export function nowEt(): EtNow {
  return etFromEpochMs(Date.now());
}

export function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function minutesToHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60).toString().padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

export const RTH_OPEN_MIN = hhmmToMinutes("09:30");
export const RTH_CLOSE_MIN = hhmmToMinutes("16:00");

export function isEtWeekday(et: EtNow): boolean {
  return et.isoWeekday >= 1 && et.isoWeekday <= 5;
}

/** Third Friday of the ET month — monthly OPEX day. */
export function isMonthlyOpex(etDate: string): boolean {
  const [y, m, d] = etDate.split("-").map(Number);
  // Day-of-week via Zeller-free approach: Date.UTC is fine here because we only
  // need the weekday of a pure calendar date.
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  if (dow !== 5) return false;
  return d >= 15 && d <= 21;
}
