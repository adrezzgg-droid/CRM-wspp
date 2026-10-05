"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Customer } from "@/types/model";
import { CUSTOMER_STAGE_LABELS } from "@/types/model";
import { CUSTOMER_STAGES } from "@/lib/schemas";
import { formatWhatsappId } from "@/lib/phone";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, CheckboxGroup, Field, inputClass, Modal } from "@/components/ui/controls";

export interface CustomerFormOptions {
  owners: { id: string; name: string }[];
  zones: { id: string; name: string }[];
  tags: { id: string; name: string; color: string }[];
  /** Puede elegir responsable (permiso "asignar" sobre clientes). */
  canAssign: boolean;
}

type Values = {
  name: string;
  company: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  neighborhood: string;
  zoneId: string;
  locality: string;
  customerType: string;
  industry: string;
  ownerId: string;
  stage: (typeof CUSTOMER_STAGES)[number];
  needsReactivation: boolean;
  tagIds: string[];
  note: string;
};

function initialValues(customer: Customer | undefined, defaultOwner: string): Values {
  return {
    name: customer?.name ?? "",
    company: customer?.company ?? "",
    phone: customer?.phone ?? "",
    whatsapp: customer?.whatsappId ? formatWhatsappId(customer.whatsappId) : "",
    email: customer?.email ?? "",
    address: customer?.address ?? "",
    neighborhood: customer?.neighborhood ?? "",
    zoneId: customer?.zoneId ?? "",
    locality: customer?.locality ?? "",
    customerType: customer?.customerType ?? "",
    industry: customer?.industry ?? "",
    ownerId: customer ? (customer.ownerId ?? "") : defaultOwner,
    stage: customer?.stage ?? "prospecto",
    needsReactivation: customer?.needsReactivation ?? false,
    tagIds: customer?.tagIds ?? [],
    note: "",
  };
}

export function CustomerFormModal({
  open,
  onClose,
  customer,
  options,
  defaultOwner,
}: {
  open: boolean;
  onClose: () => void;
  /** Sin cliente = alta. */
  customer?: Customer;
  options: CustomerFormOptions;
  defaultOwner: string;
}) {
  const router = useRouter();
  const [values, setValues] = useState<Values>(() => initialValues(customer, defaultOwner));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [duplicateId, setDuplicateId] = useState<string | null>(null);

  const set = <K extends keyof Values>(key: K, value: Values[K]) => setValues((v) => ({ ...v, [key]: value }));
  const text = (key: keyof Values) => ({
    value: values[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set(key, e.target.value as never),
  });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFieldErrors({});
    setDuplicateId(null);
    const { note, ownerId, ...rest } = values;
    const body: Record<string, unknown> = { ...rest };
    if (options.canAssign) body.ownerId = ownerId || null;
    if (!customer && note.trim()) body.note = note;
    try {
      if (customer) {
        await api("PATCH", `/api/customers/${customer.id}`, body);
        onClose();
        router.refresh();
      } else {
        const res = await api<{ customer: Customer }>("POST", "/api/customers", body);
        router.push(`/clientes/${res.customer.id}`);
      }
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) {
        setFieldErrors(err.fieldErrors);
        const dup = Array.isArray(err.details) ? (err.details[0] as { existingId?: string })?.existingId : undefined;
        if (dup) setDuplicateId(dup);
      }
      setBusy(false);
    }
  }

  const fe = fieldErrors;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={customer ? "Editar cliente" : "Nuevo cliente"}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="customer-form" loading={busy}>
            {customer ? "Guardar cambios" : "Crear cliente"}
          </Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} className="space-y-5" noValidate>
        {error && (
          <Alert>
            {error}{" "}
            {duplicateId && (
              <Link href={`/clientes/${duplicateId}`} className="font-medium underline">
                Ver cliente existente
              </Link>
            )}
          </Alert>
        )}

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Datos principales</legend>
          <Field label="Nombre *" error={fe.name}>
            {(p) => <input {...p} {...text("name")} className={inputClass} autoComplete="off" required />}
          </Field>
          <Field label="Empresa / comercio" error={fe.company}>
            {(p) => <input {...p} {...text("company")} className={inputClass} />}
          </Field>
          <Field label="WhatsApp" error={fe.whatsapp} hint="Ej.: 351 555 1234 o +54 9 351 555 1234. Vacío = se toma del teléfono.">
            {(p) => <input {...p} {...text("whatsapp")} className={inputClass} inputMode="tel" />}
          </Field>
          <Field label="Teléfono" error={fe.phone}>
            {(p) => <input {...p} {...text("phone")} className={inputClass} inputMode="tel" />}
          </Field>
          <Field label="Email" error={fe.email}>
            {(p) => <input {...p} {...text("email")} className={inputClass} type="email" />}
          </Field>
          <Field label="Etapa" error={fe.stage}>
            {(p) => (
              <select {...p} {...text("stage")} className={inputClass}>
                {CUSTOMER_STAGES.map((s) => (
                  <option key={s} value={s}>
                    {CUSTOMER_STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Ubicación y rubro</legend>
          <Field label="Dirección" error={fe.address} className="sm:col-span-2">
            {(p) => <input {...p} {...text("address")} className={inputClass} />}
          </Field>
          <Field label="Barrio" error={fe.neighborhood}>
            {(p) => <input {...p} {...text("neighborhood")} className={inputClass} />}
          </Field>
          <Field label="Localidad" error={fe.locality}>
            {(p) => <input {...p} {...text("locality")} className={inputClass} />}
          </Field>
          <Field label="Zona" error={fe.zoneId} hint={options.zones.length ? undefined : "Todavía no hay zonas cargadas."}>
            {(p) => (
              <select {...p} {...text("zoneId")} className={inputClass} disabled={!options.zones.length}>
                <option value="">Sin zona</option>
                {options.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Rubro" error={fe.industry}>
            {(p) => <input {...p} {...text("industry")} className={inputClass} placeholder="Restaurante, almacén…" />}
          </Field>
          <Field label="Tipo de cliente" error={fe.customerType}>
            {(p) => <input {...p} {...text("customerType")} className={inputClass} placeholder="Minorista, mayorista…" />}
          </Field>
          <Field label="Responsable" error={fe.ownerId} hint={options.canAssign ? undefined : "Los clientes que creás quedan a tu cargo."}>
            {(p) => (
              <select {...p} {...text("ownerId")} className={inputClass} disabled={!options.canAssign}>
                {options.canAssign && <option value="">Sin asignar</option>}
                {options.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">Etiquetas y seguimiento</legend>
          <CheckboxGroup
            options={options.tags.map((t) => ({ id: t.id, label: t.name, color: t.color }))}
            value={values.tagIds}
            onChange={(v) => set("tagIds", v)}
            empty="No hay etiquetas creadas."
          />
          {fe.tagIds && <p className="text-xs text-red-600">{fe.tagIds}</p>}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.needsReactivation}
              onChange={(e) => set("needsReactivation", e.target.checked)}
              className="size-4 accent-brand-600"
            />
            Marcar para reactivar
          </label>
          {!customer && (
            <Field label="Nota inicial" error={fe.note}>
              {(p) => <textarea {...p} {...text("note")} rows={3} className={inputClass} placeholder="Cómo llegó, qué pidió…" />}
            </Field>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

/** Botón + modal de alta. */
export function NewCustomerButton({ options, defaultOwner }: { options: CustomerFormOptions; defaultOwner: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>Nuevo cliente</Button>
      {open && <CustomerFormModal open onClose={() => setOpen(false)} options={options} defaultOwner={defaultOwner} />}
    </>
  );
}
