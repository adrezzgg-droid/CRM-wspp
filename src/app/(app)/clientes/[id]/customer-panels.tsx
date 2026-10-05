"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import type { Contact, Customer } from "@/types/model";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, inputClass, Modal } from "@/components/ui/controls";
import { CustomerFormModal, type CustomerFormOptions } from "../customer-form";
import { OpportunityFormModal, type OpportunityFormOptions } from "@/components/commercial/opportunity-form";
import type { ProductOption } from "@/components/commercial/order-form";
import { NewOrderButton } from "../../pedidos/order-actions";

/** Nueva oportunidad / nuevo pedido para este cliente. */
export function CommercialActions({
  customer,
  opportunityOptions,
  products,
  currency,
}: {
  customer: { id: string; name: string; company?: string; address?: string };
  opportunityOptions: OpportunityFormOptions | null;
  products: ProductOption[] | null;
  currency: string;
}) {
  const [creating, setCreating] = useState(false);
  return (
    <>
      {opportunityOptions && (
        <Button variant="secondary" onClick={() => setCreating(true)}>
          <Plus className="size-4" aria-hidden /> Oportunidad
        </Button>
      )}
      {products && <NewOrderButton variant="secondary" label="Pedido" products={products} currency={currency} customer={customer} />}
      {creating && opportunityOptions && <OpportunityFormModal open onClose={() => setCreating(false)} options={opportunityOptions} customer={customer} />}
    </>
  );
}

export function CustomerActions({
  customer,
  options,
  canEdit,
  canArchive,
}: {
  customer: Customer;
  options: CustomerFormOptions;
  canEdit: boolean;
  canArchive: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleArchived() {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/customers/${customer.id}/archive`, { archived: !customer.archived });
      setConfirming(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {canEdit && !customer.archived && (
        <Button variant="secondary" onClick={() => setEditing(true)}>
          <Pencil className="size-4" aria-hidden /> Editar
        </Button>
      )}
      {canArchive && (
        <Button variant={customer.archived ? "secondary" : "ghost"} onClick={() => (customer.archived ? toggleArchived() : setConfirming(true))} loading={busy && !confirming}>
          {customer.archived ? "Restaurar cliente" : "Dar de baja"}
        </Button>
      )}
      {error && !confirming && <Alert>{error}</Alert>}
      {editing && (
        <CustomerFormModal open onClose={() => setEditing(false)} customer={customer} options={options} defaultOwner={customer.ownerId ?? ""} />
      )}
      <Modal
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Dar de baja al cliente"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={toggleArchived} loading={busy}>
              Dar de baja
            </Button>
          </>
        }
      >
        <p className="text-sm">
          <strong>{customer.name}</strong> deja de aparecer en los listados. Su historial, notas y pedidos se conservan y se puede restaurar en
          cualquier momento.
        </p>
        {error && <div className="mt-3"><Alert>{error}</Alert></div>}
      </Modal>
    </div>
  );
}

export function NoteForm({ customerId }: { customerId: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/customers/${customerId}/notes`, { text });
      setText("");
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="new-note" className="sr-only">
        Nueva nota
      </label>
      <textarea
        id="new-note"
        rows={3}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Escribí una nota interna (no la ve el cliente)…"
        className={inputClass}
      />
      {error && <Alert>{error}</Alert>}
      <div className="flex justify-end">
        <Button type="submit" loading={busy} disabled={!text.trim()}>
          Agregar nota
        </Button>
      </div>
    </form>
  );
}

type ContactValues = { name: string; role: string; phone: string; email: string };

function ContactModal({ customerId, contact, onClose }: { customerId: string; contact?: Contact; onClose: () => void }) {
  const router = useRouter();
  const [values, setValues] = useState<ContactValues>({
    name: contact?.name ?? "",
    role: contact?.role ?? "",
    phone: contact?.phone ?? "",
    email: contact?.email ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFe({});
    try {
      if (contact) await api("PATCH", `/api/customers/${customerId}/contacts/${contact.id}`, values);
      else await api("POST", `/api/customers/${customerId}/contacts`, values);
      onClose();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) setFe(err.fieldErrors);
      setBusy(false);
    }
  }

  const bind = (k: keyof ContactValues) => ({
    value: values[k],
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValues((v) => ({ ...v, [k]: e.target.value })),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title={contact ? "Editar contacto" : "Nuevo contacto"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="contact-form" loading={busy}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="contact-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <Field label="Nombre *" error={fe.name}>{(p) => <input {...p} {...bind("name")} className={inputClass} />}</Field>
        <Field label="Cargo" error={fe.role}>{(p) => <input {...p} {...bind("role")} className={inputClass} placeholder="Encargado, dueño…" />}</Field>
        <Field label="Teléfono" error={fe.phone}>{(p) => <input {...p} {...bind("phone")} className={inputClass} inputMode="tel" />}</Field>
        <Field label="Email" error={fe.email}>{(p) => <input {...p} {...bind("email")} className={inputClass} type="email" />}</Field>
      </form>
    </Modal>
  );
}

export function ContactsPanel({ customerId, contacts, canEdit }: { customerId: string; contacts: Contact[]; canEdit: boolean }) {
  const router = useRouter();
  const [modal, setModal] = useState<{ contact?: Contact } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(contact: Contact) {
    if (!window.confirm(`¿Eliminar el contacto ${contact.name}? Queda registrado en el historial.`)) return;
    setError(null);
    try {
      await api("DELETE", `/api/customers/${customerId}/contacts/${contact.id}`);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-2">
      {contacts.length === 0 ? (
        <p className="text-sm text-ink-muted">Sin contactos adicionales.</p>
      ) : (
        <ul className="divide-y divide-line">
          {contacts.map((c) => (
            <li key={c.id} className="flex items-start gap-2 py-2">
              <div className="min-w-0 flex-1 text-sm">
                <p className="font-medium">
                  {c.name} {c.role && <span className="font-normal text-ink-muted">· {c.role}</span>}
                </p>
                <p className="truncate text-xs text-ink-muted">{[c.phone, c.email].filter(Boolean).join(" · ") || "Sin datos"}</p>
              </div>
              {canEdit && (
                <div className="flex shrink-0">
                  <button type="button" onClick={() => setModal({ contact: c })} className="rounded p-1.5 text-ink-muted hover:bg-canvas" aria-label={`Editar ${c.name}`}>
                    <Pencil className="size-3.5" aria-hidden />
                  </button>
                  <button type="button" onClick={() => remove(c)} className="rounded p-1.5 text-ink-muted hover:bg-red-50 hover:text-red-600" aria-label={`Eliminar ${c.name}`}>
                    <Trash2 className="size-3.5" aria-hidden />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {error && <Alert>{error}</Alert>}
      {canEdit && (
        <Button variant="ghost" className="px-2" onClick={() => setModal({})}>
          <Plus className="size-4" aria-hidden /> Agregar contacto
        </Button>
      )}
      {modal && <ContactModal customerId={customerId} contact={modal.contact} onClose={() => setModal(null)} />}
    </div>
  );
}
