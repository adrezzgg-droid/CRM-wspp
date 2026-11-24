// Íconos de cada sección. Módulo común (no "use client"): lo usan la barra superior (cliente) y el
// panel de inicio (servidor). Un valor exportado desde un módulo "use client" no se puede leer en el
// servidor.
import { Boxes, ChartColumn, Inbox, Package, Settings, ShieldCheck, SquareCheckBig, SquareKanban, Sun, Users, type LucideIcon } from "lucide-react";
import type { NavIcon } from "@/lib/navigation";

export const NAV_ICONS: Record<NavIcon, LucideIcon> = {
  sun: Sun,
  chart: ChartColumn,
  inbox: Inbox,
  users: Users,
  kanban: SquareKanban,
  package: Package,
  boxes: Boxes,
  check: SquareCheckBig,
  shield: ShieldCheck,
  settings: Settings,
};
