/**
 * Datos iniciales de toda organización nueva (real o demo).
 * Código puro: lo usan los scripts de alta y, más adelante, la API.
 */
import type { Member, Organization, PipelineStage, Tag } from "../../types/model.ts";
import type { Role } from "../permissions/matrix.ts";

export const DEFAULT_PIPELINE_ID = "principal";

export const DEFAULT_PIPELINE_STAGES: PipelineStage[] = [
  { id: "nuevo_lead", name: "Nuevo lead", order: 1, probability: 10, kind: "abierta" },
  { id: "contactado", name: "Contactado", order: 2, probability: 20, kind: "abierta" },
  { id: "interesado", name: "Interesado", order: 3, probability: 35, kind: "abierta" },
  { id: "cotizacion", name: "Cotización", order: 4, probability: 50, kind: "abierta" },
  { id: "negociacion", name: "Negociación", order: 5, probability: 65, kind: "abierta" },
  { id: "pedido", name: "Pedido", order: 6, probability: 85, kind: "abierta" },
  { id: "venta", name: "Venta", order: 7, probability: 100, kind: "ganada" },
  { id: "seguimiento", name: "Seguimiento", order: 8, probability: 100, kind: "ganada" },
  { id: "perdido", name: "Perdido", order: 9, probability: 0, kind: "perdida" },
];

export const DEFAULT_TAGS: Pick<Tag, "id" | "name" | "color">[] = [
  { id: "nuevo", name: "NUEVO", color: "#2a9781" },
  { id: "urgente", name: "URGENTE", color: "#dc2626" },
  { id: "mayorista", name: "MAYORISTA", color: "#7c3aed" },
  { id: "restaurante", name: "RESTAURANTE", color: "#ea580c" },
  { id: "almacen", name: "ALMACÉN", color: "#0891b2" },
  { id: "polleria", name: "POLLERÍA", color: "#ca8a04" },
  { id: "reactivar", name: "REACTIVAR", color: "#db2777" },
  { id: "pedido", name: "PEDIDO", color: "#2563eb" },
  { id: "potencial", name: "POTENCIAL", color: "#65a30d" },
  { id: "cliente_activo", name: "CLIENTE ACTIVO", color: "#16a34a" },
];

export function newOrganization(input: {
  id: string;
  name: string;
  isDemo: boolean;
  timezone?: string;
  currency?: string;
  actor: string;
  now?: number;
}): Organization {
  const now = input.now ?? Date.now();
  return {
    id: input.id,
    name: input.name,
    isDemo: input.isDemo,
    plan: "pro",
    timezone: input.timezone ?? "America/Argentina/Cordoba",
    currency: input.currency ?? "ARS",
    status: "active",
    createdAt: now,
    createdBy: input.actor,
    updatedAt: now,
    updatedBy: input.actor,
  };
}

export function newMember(input: {
  uid: string;
  orgId: string;
  isDemo: boolean;
  displayName: string;
  email: string;
  role: Role;
  teamIds?: string[];
  zoneIds?: string[];
  actor: string;
  now?: number;
}): Member {
  const now = input.now ?? Date.now();
  return {
    id: input.uid,
    orgId: input.orgId,
    isDemo: input.isDemo,
    displayName: input.displayName,
    email: input.email,
    role: input.role,
    teamIds: input.teamIds ?? [],
    zoneIds: input.zoneIds ?? [],
    active: true,
    available: input.role === "vendedor",
    notificationPrefs: {},
    createdAt: now,
    createdBy: input.actor,
    updatedAt: now,
    updatedBy: input.actor,
  };
}

/** Id legible y único para una organización a partir de su nombre. */
export function orgIdFromName(name: string, random: () => string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
  return `${slug || "org"}-${random()}`;
}
