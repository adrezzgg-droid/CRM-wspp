"use client";

import { useEffect, useId, useState } from "react";
import { Search, X } from "lucide-react";
import { api } from "@/lib/api-client";
import { formatWhatsappId } from "@/lib/phone";
import { inputClass } from "@/components/ui/styles";

export type PickedCustomer = { id: string; name: string; company?: string; address?: string };

type Row = PickedCustomer & { whatsappId?: string; phone?: string };

/** Busca clientes (dentro del alcance del usuario) para vincular a una oportunidad o pedido. */
export function CustomerPicker({ value, onChange, invalid }: { value: PickedCustomer | null; onChange: (c: PickedCustomer | null) => void; invalid?: boolean }) {
  const listId = useId();
  const [q, setQ] = useState("");
  const [result, setResult] = useState<{ q: string; rows: Row[] } | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) return;
    const timer = setTimeout(() => {
      api<{ items: Row[] }>("GET", `/api/customers?q=${encodeURIComponent(term)}`)
        .then((r) => setResult({ q: term, rows: r.items.slice(0, 8) }))
        .catch(() => setResult({ q: term, rows: [] }));
    }, 250);
    return () => clearTimeout(timer);
  }, [q]);

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-line bg-canvas px-3 py-2 text-sm">
        <span className="min-w-0 truncate">
          <span className="font-medium">{value.name}</span>
          {value.company && <span className="text-ink-muted"> · {value.company}</span>}
        </span>
        <button type="button" onClick={() => onChange(null)} className="rounded p-0.5 text-ink-muted hover:bg-line" aria-label="Cambiar cliente">
          <X className="size-4" aria-hidden />
        </button>
      </div>
    );
  }

  const rows = result && result.q === q.trim() ? result.rows : [];
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-ink-muted" aria-hidden />
      <input
        role="combobox"
        aria-expanded={open && rows.length > 0}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        placeholder="Buscar cliente por nombre o teléfono"
        className={`${inputClass} pl-9`}
      />
      {open && q.trim().length >= 2 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-line bg-surface shadow-lg">
          {rows.length === 0 ? (
            <li className="px-3 py-2 text-sm text-ink-muted">{result?.q === q.trim() ? "Sin resultados" : "Buscando…"}</li>
          ) : (
            rows.map((c) => (
              <li key={c.id} role="option" aria-selected={false}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onChange({ id: c.id, name: c.name, company: c.company, address: c.address })}
                  className="block w-full px-3 py-2 text-left text-sm hover:bg-canvas"
                >
                  <span className="font-medium">{c.name}</span>
                  <span className="block text-xs text-ink-muted">{[c.company, c.whatsappId ? formatWhatsappId(c.whatsappId) : c.phone].filter(Boolean).join(" · ")}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}
