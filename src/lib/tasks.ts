/**
 * Tareas: fechas en la zona horaria de la empresa y vistas Hoy / Vencidas /
 * Próximas / Completadas. Código puro.
 */
import type { Task } from "../types/model.ts";

function partsIn(ms: number, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = Object.fromEntries(f.formatToParts(ms).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Diferencia entre la hora local de `timeZone` y UTC en ese instante (ms). */
function offsetAt(ms: number, timeZone: string): number {
  const p = partsIn(ms, timeZone);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

/** "2026-10-05" + "09:30" en la zona de la empresa → epoch ms. */
export function zonedTimeToMs(date: string, time: string, timeZone: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetAt(guess, timeZone);
  const second = guess - offsetAt(first, timeZone); // corrige si el cambio de horario cae en medio
  return second;
}

/** Fecha (AAAA-MM-DD) y hora (HH:MM) de un instante en la zona de la empresa. */
export function msToZoned(ms: number, timeZone: string): { date: string; time: string } {
  const p = partsIn(ms, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

/** Inicio y fin (inclusive) del día de `ms` en la zona de la empresa. */
export function dayBounds(ms: number, timeZone: string): { start: number; end: number } {
  const p = partsIn(ms, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const start = zonedTimeToMs(`${p.y}-${pad(p.m)}-${pad(p.d)}`, "00:00", timeZone);
  const next = new Date(Date.UTC(p.y, p.m - 1, p.d + 1));
  const nextStart = zonedTimeToMs(`${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`, "00:00", timeZone);
  return { start, end: nextStart - 1 };
}

export const TASK_VIEWS = ["hoy", "vencidas", "proximas", "completadas"] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const TASK_VIEW_LABELS: Record<TaskView, string> = {
  hoy: "Hoy",
  vencidas: "Vencidas",
  proximas: "Próximas",
  completadas: "Completadas",
};

/** En qué vista cae una tarea. Las canceladas no aparecen en ninguna. */
export function taskView(t: Pick<Task, "status" | "dueAt">, now: number, timeZone: string): TaskView | null {
  if (t.status === "completada") return "completadas";
  if (t.status === "cancelada") return null;
  const { start, end } = dayBounds(now, timeZone);
  if (t.dueAt < start) return "vencidas";
  if (t.dueAt <= end) return "hoy";
  return "proximas";
}

/** Pendiente y con la hora ya pasada (incluye las de hoy). */
export function isLate(t: Pick<Task, "status" | "dueAt">, now: number): boolean {
  return t.status === "pendiente" && t.dueAt < now;
}
