"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import type { Task } from "@/types/model";
import { TASK_TYPE_LABELS } from "@/types/model";
import { TASK_PRIORITIES, TASK_TYPES } from "@/lib/schemas";
import { msToZoned } from "@/lib/tasks";
import { api, ApiClientError, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, inputClass, Modal } from "@/components/ui/controls";
import { CustomerPicker, type PickedCustomer } from "@/components/commercial/customer-picker";

export interface TaskFormOptions {
  timezone: string;
  /** Hoy en la zona de la empresa (AAAA-MM-DD). */
  today: string;
  /** Responsables posibles; vacío = solo el propio usuario. */
  assignees: { id: string; name: string }[];
  /** Puede vincular clientes (tiene permiso de ver clientes). */
  canPickCustomer: boolean;
}

const PRIORITY_LABELS = { baja: "Baja", normal: "Normal", alta: "Alta" } as const;

export function TaskFormModal({
  onClose,
  options,
  task,
  customer,
  context,
}: {
  onClose: () => void;
  options: TaskFormOptions;
  task?: Task;
  customer?: PickedCustomer;
  context?: { conversationId?: string; opportunityId?: string };
}) {
  const router = useRouter();
  const local = task ? msToZoned(task.dueAt, options.timezone) : null;
  const [picked, setPicked] = useState<PickedCustomer | null>(customer ?? (task?.customerId ? { id: task.customerId, name: task.customerName ?? "Cliente" } : null));
  const [v, setV] = useState({
    type: task?.type ?? ("llamada" as Task["type"]),
    priority: task?.priority ?? ("normal" as Task["priority"]),
    dueDate: local?.date ?? options.today,
    dueTime: local?.time ?? "10:00",
    description: task?.description ?? "",
    assigneeId: task?.assigneeId ?? "",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fe, setFe] = useState<Record<string, string>>({});
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setV((s) => ({ ...s, [k]: e.target.value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFe({});
    const body: Record<string, unknown> = {
      type: v.type,
      priority: v.priority,
      dueDate: v.dueDate,
      dueTime: v.dueTime,
      description: v.description,
      ...(v.assigneeId ? { assigneeId: v.assigneeId } : {}),
    };
    try {
      if (task) {
        if (!customer) body.customerId = picked?.id ?? null;
        await api("PATCH", `/api/tasks/${task.id}`, body);
      } else {
        await api("POST", "/api/tasks", { ...body, ...(picked ? { customerId: picked.id } : {}), ...context });
      }
      onClose();
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiClientError) setFe(err.fieldErrors);
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={task ? "Editar tarea" : "Nueva tarea"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="submit" form="task-form" loading={busy}>
            Guardar
          </Button>
        </>
      }
    >
      <form id="task-form" onSubmit={submit} className="grid gap-4 sm:grid-cols-2" noValidate>
        {error && <div className="sm:col-span-2"><Alert>{error}</Alert></div>}
        <Field label="Tipo" error={fe.type}>
          {(p) => (
            <select {...p} value={v.type} onChange={set("type")} className={inputClass}>
              {TASK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TASK_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Prioridad" error={fe.priority}>
          {(p) => (
            <select {...p} value={v.priority} onChange={set("priority")} className={inputClass}>
              {TASK_PRIORITIES.map((t) => (
                <option key={t} value={t}>
                  {PRIORITY_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Fecha" error={fe.dueDate}>
          {(p) => <input {...p} type="date" value={v.dueDate} onChange={set("dueDate")} className={inputClass} />}
        </Field>
        <Field label="Hora" error={fe.dueTime}>
          {(p) => <input {...p} type="time" value={v.dueTime} onChange={set("dueTime")} className={inputClass} />}
        </Field>
        {(options.canPickCustomer || customer) && (
          <div className="sm:col-span-2">
            <p className="mb-1 text-sm font-medium">Cliente</p>
            {customer ? (
              <p className="rounded-lg bg-canvas px-3 py-2 text-sm font-medium">{customer.name}</p>
            ) : (
              <CustomerPicker value={picked} onChange={setPicked} />
            )}
          </div>
        )}
        {options.assignees.length > 0 && (
          <Field label="Responsable" error={fe.assigneeId} className="sm:col-span-2">
            {(p) => (
              <select {...p} value={v.assigneeId} onChange={set("assigneeId")} className={inputClass}>
                {!task && <option value="">Yo</option>}
                {options.assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <Field label="Descripción" error={fe.description} className="sm:col-span-2">
          {(p) => <textarea {...p} value={v.description} onChange={set("description")} rows={3} className={inputClass} placeholder="Llamar para confirmar el pedido del viernes…" />}
        </Field>
      </form>
    </Modal>
  );
}

export function NewTaskButton({
  options,
  customer,
  context,
  variant = "primary",
  label = "Nueva tarea",
  className = "",
}: {
  options: TaskFormOptions;
  customer?: PickedCustomer;
  context?: { conversationId?: string; opportunityId?: string };
  variant?: "primary" | "secondary" | "ghost";
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} className={className} onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden /> {label}
      </Button>
      {open && <TaskFormModal onClose={() => setOpen(false)} options={options} customer={customer} context={context} />}
    </>
  );
}
