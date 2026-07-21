// Client-safe market-hours helpers shared by the daypart entry and panel
// components. No secrets here — safe to import from client components.

export const MARKET_OPEN = "09:30";
export const MARKET_CLOSE = "16:00";

export function generateTimeOptions(start: string, end: string, stepMinutes: number): string[] {
  const [startHour, startMinute] = start.split(":").map(Number);
  const [endHour, endMinute] = end.split(":").map(Number);
  const startTotal = startHour * 60 + startMinute;
  const endTotal = endHour * 60 + endMinute;

  const options: string[] = [];
  for (let minutes = startTotal; minutes <= endTotal; minutes += stepMinutes) {
    const hour = Math.floor(minutes / 60).toString().padStart(2, "0");
    const minute = (minutes % 60).toString().padStart(2, "0");
    options.push(`${hour}:${minute}`);
  }
  return options;
}

export function defaultEtDate(): string {
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  return formatter.format(new Date());
}

export const TIME_OPTIONS = generateTimeOptions(MARKET_OPEN, MARKET_CLOSE, 15);
