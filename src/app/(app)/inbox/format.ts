/** Formatos de fecha de la bandeja, en la zona horaria de la empresa. */

export function makeFormatters(timeZone: string) {
  const time = new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", timeZone });
  const day = new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone });
  const longDay = new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long", timeZone });
  const dayKey = new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", timeZone });

  /** Hora si es de hoy, "Ayer" o la fecha corta. */
  function listTime(ms: number | undefined, now = Date.now()): string {
    if (!ms) return "";
    const k = dayKey.format(ms);
    if (k === dayKey.format(now)) return time.format(ms);
    if (k === dayKey.format(now - 86_400_000)) return "Ayer";
    return day.format(ms);
  }

  function dayLabel(ms: number, now = Date.now()): string {
    const k = dayKey.format(ms);
    if (k === dayKey.format(now)) return "Hoy";
    if (k === dayKey.format(now - 86_400_000)) return "Ayer";
    return longDay.format(ms);
  }

  return { time: (ms: number) => time.format(ms), listTime, dayLabel, dayKey: (ms: number) => dayKey.format(ms) };
}

export function initials(name: string): string {
  return (
    name
      .replace(/^\+/, "")
      .split(/\s+/)
      .filter((w) => /\p{L}/u.test(w))
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join("") || "#"
  );
}

export function formatBytes(n?: number): string {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
