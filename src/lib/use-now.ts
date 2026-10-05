"use client";

import { useEffect, useState } from "react";

/** Hora actual que se renueva cada `intervalMs` (para contadores de espera). */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
