"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Search } from "lucide-react";
import type { Conversation } from "@/types/model";
import { CONVERSATION_STATUS_LABELS } from "@/types/model";
import { INBOX_FILTERS, type InboxFilter } from "@/lib/inbox-filters";
import { normalizeText } from "@/lib/search";
import { formatWhatsappId } from "@/lib/phone";
import { inputClass } from "@/components/ui/styles";
import { makeFormatters, initials } from "./format";
import { SimulatorButton } from "./simulator";
import type { InboxProps } from "./types";

const STATUS_DOT: Record<Conversation["status"], string> = {
  nueva: "bg-sky-500",
  pendiente: "bg-amber-500",
  en_atencion: "bg-brand-500",
  cerrada: "bg-slate-400",
};

export function ConversationList({
  props,
  filter,
  onFilter,
  items,
  loading,
  error,
  selectedId,
  onSelect,
  names,
  tags,
}: {
  props: InboxProps;
  filter: InboxFilter;
  onFilter: (f: InboxFilter) => void;
  items: Conversation[];
  loading: boolean;
  error: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  names: Map<string, string>;
  tags: Map<string, { name: string; color: string }>;
}) {
  const [search, setSearch] = useState("");
  const fmt = useMemo(() => makeFormatters(props.timezone), [props.timezone]);
  const filters = INBOX_FILTERS.filter((f) => !(f.id === "sin_asignar" && props.scope === "propio"));

  const visible = useMemo(() => {
    const q = normalizeText(search);
    if (!q) return items;
    const digits = search.replace(/\D/g, "");
    return items.filter((c) => normalizeText(c.contactName).includes(q) || (digits.length >= 3 && c.waContactId.includes(digits)));
  }, [items, search]);

  return (
    <>
      <div className="space-y-2 border-b border-line p-3">
        <div className="flex items-center justify-between gap-2">
          <h1 className="text-base font-semibold">Bandeja</h1>
          {props.isDemo && <SimulatorButton onCreated={onSelect} />}
        </div>
        <label className="relative block">
          <span className="sr-only">Buscar conversación</span>
          <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-muted" aria-hidden />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o número" className={`${inputClass} pl-9`} />
        </label>
        <div role="tablist" aria-label="Filtros" className="-mx-3 flex gap-1 overflow-x-auto px-3 pb-1">
          {filters.map((f) => (
            <button
              key={f.id}
              role="tab"
              type="button"
              aria-selected={filter === f.id}
              onClick={() => onFilter(f.id)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap transition ${filter === f.id ? "bg-brand-600 text-white" : "bg-canvas text-ink-muted hover:text-ink"}`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <p role="alert" className="m-3 flex gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="size-4 shrink-0" aria-hidden /> {error}
          </p>
        ) : loading ? (
          <ul aria-busy="true" className="space-y-1 p-2">
            {Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="h-16 animate-pulse rounded-lg bg-canvas" />
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <p className="p-6 text-center text-sm text-ink-muted">{search ? "No hay coincidencias." : "No hay conversaciones en este filtro."}</p>
        ) : (
          <ul className="divide-y divide-line">
            {visible.map((c) => {
              const active = c.id === selectedId;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(c.id)}
                    aria-current={active ? "true" : undefined}
                    className={`flex w-full gap-3 px-3 py-3 text-left transition ${active ? "bg-brand-50" : "hover:bg-canvas"}`}
                  >
                    <span className="relative grid size-10 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800" aria-hidden>
                      {initials(c.contactName)}
                      <span className={`absolute -right-0.5 -bottom-0.5 size-3 rounded-full border-2 border-surface ${STATUS_DOT[c.status]}`} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-sm ${c.unreadCount ? "font-semibold" : "font-medium"}`}>{c.contactName}</span>
                        <span className={`shrink-0 text-[11px] ${c.unreadCount ? "font-semibold text-brand-700" : "text-ink-muted"}`}>{fmt.listTime(c.lastMessageAt)}</span>
                      </span>
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-xs ${c.unreadCount ? "text-ink" : "text-ink-muted"}`}>
                          {c.lastMessageDirection === "out" && "Vos: "}
                          {c.lastMessagePreview ?? ""}
                        </span>
                        {c.unreadCount > 0 && (
                          <span className="min-w-5 shrink-0 rounded-full bg-brand-600 px-1.5 text-center text-[11px] leading-5 font-semibold text-white" aria-label={`${c.unreadCount} sin leer`}>
                            {c.unreadCount > 99 ? "99+" : c.unreadCount}
                          </span>
                        )}
                      </span>
                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-muted">
                        <span>{formatWhatsappId(c.waContactId)}</span>
                        <span>· {c.assigneeId ? names.get(c.assigneeId) ?? "—" : <span className="text-amber-700">Sin asignar</span>}</span>
                        <span className="sr-only">Estado: {CONVERSATION_STATUS_LABELS[c.status]}</span>
                        {(c.priority === "alta" || c.priority === "urgente") && (
                          <span className={`rounded px-1 font-semibold uppercase ${c.priority === "urgente" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>{c.priority}</span>
                        )}
                        {c.tagIds.slice(0, 3).map((id) => {
                          const t = tags.get(id);
                          return t ? (
                            <span key={id} className="inline-flex items-center gap-1">
                              <span className="size-1.5 rounded-full" style={{ background: t.color }} aria-hidden />
                              {t.name}
                            </span>
                          ) : null;
                        })}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
