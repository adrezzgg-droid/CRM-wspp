import type { Activity, CustomerStage } from "@/types/model";
import { CUSTOMER_STAGE_LABELS } from "@/types/model";

/** Nombres legibles de los campos que aparecen en el historial de cambios. */
const FIELD_LABELS: Record<string, string> = {
  name: "Nombre",
  company: "Empresa",
  phone: "Teléfono",
  whatsappId: "WhatsApp",
  email: "Email",
  address: "Dirección",
  neighborhood: "Barrio",
  zoneId: "Zona",
  locality: "Localidad",
  customerType: "Tipo de cliente",
  industry: "Rubro",
  ownerId: "Responsable",
  stage: "Etapa",
  needsReactivation: "Para reactivar",
  tagIds: "Etiquetas",
  role: "Cargo",
};

export interface TimelineLookups {
  members: Map<string, string>;
  tags: Map<string, string>;
  zones: Map<string, string>;
}

function formatValue(field: string, value: unknown, l: TimelineLookups): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (field === "ownerId") return l.members.get(String(value)) ?? "usuario eliminado";
  if (field === "zoneId") return l.zones.get(String(value)) ?? String(value);
  if (field === "stage") return CUSTOMER_STAGE_LABELS[value as CustomerStage] ?? String(value);
  if (field === "tagIds" && Array.isArray(value)) return value.map((t) => l.tags.get(t) ?? t).join(", ") || "—";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

type Change = { before: unknown; after: unknown };

const isChange = (v: unknown): v is Change => !!v && typeof v === "object" && "before" in v && "after" in v;

/** Cambios guardados en `data.changes` o como `data.<campo> = { before, after }` (etapa, responsable). */
function changesOf(a: Activity): [string, Change][] {
  const out: [string, Change][] = [];
  for (const [key, value] of Object.entries(a.data ?? {})) {
    if (key === "changes" && value && typeof value === "object") {
      out.push(...Object.entries(value as Record<string, unknown>).filter((e): e is [string, Change] => isChange(e[1])));
    } else if (isChange(value)) {
      out.push([key, value]);
    }
  }
  return out;
}

function actorName(id: Activity["actorId"], l: TimelineLookups): string {
  if (id === "system") return "Sistema";
  if (id === "webhook") return "WhatsApp";
  if (id === "customer") return "Cliente";
  return l.members.get(id) ?? "Usuario";
}

export function ActivityTimeline({ items, lookups, timezone }: { items: Activity[]; lookups: TimelineLookups; timezone: string }) {
  if (!items.length) return <p className="text-sm text-ink-muted">Sin actividad registrada.</p>;
  const fmt = new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeStyle: "short", timeZone: timezone });
  return (
    <ol className="relative space-y-4 border-l border-line pl-5">
      {items.map((a) => {
        const changes = changesOf(a);
        return (
          <li key={a.id} className="relative">
            <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface bg-brand-500" aria-hidden />
            <p className="text-xs text-ink-muted">
              <time dateTime={new Date(a.at).toISOString()}>{fmt.format(a.at)}</time> · {actorName(a.actorId, lookups)}
            </p>
            <p className="text-sm">{a.summary}</p>
            {changes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
                {changes.map(([field, c]) => (
                  <li key={field}>
                    <span className="font-medium text-ink">{FIELD_LABELS[field] ?? field}:</span>{" "}
                    <span className="line-through decoration-ink-muted/50">{formatValue(field, c.before, lookups)}</span> →{" "}
                    {formatValue(field, c.after, lookups)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ol>
  );
}
