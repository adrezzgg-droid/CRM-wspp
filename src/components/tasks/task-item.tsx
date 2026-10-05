"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, FileText, HeartHandshake, MapPin, MessageCircle, Pencil, Phone, RotateCcw, Search, X } from "lucide-react";
import type { Task } from "@/types/model";
import { TASK_TYPE_LABELS } from "@/types/model";
import { isLate } from "@/lib/tasks";
import { api, errorMessage } from "@/lib/api-client";
import { Alert, Button, Field, inputClass, Modal } from "@/components/ui/controls";
import { TaskFormModal, type TaskFormOptions } from "./task-form";

const ICONS = { llamada: Phone, whatsapp: MessageCircle, visita: MapPin, seguimiento: Search, cotizacion: FileText, postventa: HeartHandshake } as const;

/** Tarjeta de tarea: completar con resultado, editar, cancelar o reabrir. */
export function TaskItem({
  task,
  now,
  timezone,
  canEdit,
  options,
  assigneeName,
}: {
  task: Task;
  now: number;
  timezone: string;
  canEdit: boolean;
  options: TaskFormOptions | null;
  /** Se muestra cuando la tarea es de otra persona. */
  assigneeName?: string;
}) {
  const router = useRouter();
  const [completing, setCompleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const Icon = ICONS[task.type];
  const late = isLate(task, now);
  const fmt = new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: timezone });

  async function setStatus(status: Task["status"], withOutcome?: string) {
    setBusy(true);
    setError(null);
    try {
      await api("POST", `/api/tasks/${task.id}/status`, { status, outcome: withOutcome });
      setCompleting(false);
      router.refresh();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const done = task.status === "completada";
  return (
    <li className={`rounded-xl border bg-surface p-3 ${late ? "border-red-200" : "border-line"}`}>
      <div className="flex items-start gap-3">
        <span className={`grid size-9 shrink-0 place-items-center rounded-full ${done ? "bg-green-50 text-green-700" : late ? "bg-red-50 text-red-600" : "bg-brand-50 text-brand-700"}`} aria-hidden>
          {done ? <Check className="size-4" /> : <Icon className="size-4" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className={`text-sm font-medium ${done ? "text-ink-muted line-through" : ""}`}>
            {TASK_TYPE_LABELS[task.type]}
            {task.customerName && (
              <>
                {" "}
                con{" "}
                {task.customerId ? (
                  <Link href={`/clientes/${task.customerId}`} className="text-brand-700 hover:underline">
                    {task.customerName}
                  </Link>
                ) : (
                  task.customerName
                )}
              </>
            )}
            {task.priority === "alta" && !done && <span className="ml-2 rounded bg-red-100 px-1 text-[10px] font-semibold text-red-700 uppercase">Alta</span>}
          </p>
          <p className={`text-xs ${late ? "font-semibold text-red-700" : "text-ink-muted"}`}>
            {fmt.format(task.dueAt)}
            {late && " · vencida"}
            {assigneeName && ` · ${assigneeName}`}
          </p>
          {task.description && <p className="mt-1 text-sm whitespace-pre-wrap">{task.description}</p>}
          {done && task.outcome && <p className="mt-1 rounded-lg bg-green-50 px-2 py-1 text-xs text-green-900">Resultado: {task.outcome}</p>}
          {task.conversationId && !done && (
            <Link href={`/inbox?c=${task.conversationId}`} className="mt-1 inline-block text-xs font-medium text-brand-700 hover:underline">
              Abrir conversación
            </Link>
          )}
        </div>
        {canEdit && (
          <div className="flex shrink-0 items-center gap-1">
            {task.status === "pendiente" ? (
              <>
                {options && (
                  <button type="button" onClick={() => setEditing(true)} className="rounded p-1.5 text-ink-muted hover:bg-canvas" aria-label="Editar tarea">
                    <Pencil className="size-4" aria-hidden />
                  </button>
                )}
                <button type="button" onClick={() => setStatus("cancelada")} disabled={busy} className="rounded p-1.5 text-ink-muted hover:bg-canvas" aria-label="Cancelar tarea">
                  <X className="size-4" aria-hidden />
                </button>
                <Button className="px-2.5 py-1.5 text-xs" onClick={() => setCompleting(true)}>
                  <Check className="size-3.5" aria-hidden /> Hecha
                </Button>
              </>
            ) : (
              <button type="button" onClick={() => setStatus("pendiente")} disabled={busy} className="rounded p-1.5 text-ink-muted hover:bg-canvas" aria-label="Reabrir tarea" title="Reabrir">
                <RotateCcw className="size-4" aria-hidden />
              </button>
            )}
          </div>
        )}
      </div>
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
      {editing && options && <TaskFormModal onClose={() => setEditing(false)} options={options} task={task} />}
      <Modal
        open={completing}
        onClose={() => setCompleting(false)}
        title={`${TASK_TYPE_LABELS[task.type]} realizada`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setCompleting(false)}>
              Volver
            </Button>
            <Button onClick={() => setStatus("completada", outcome.trim() || undefined)} loading={busy}>
              Marcar como hecha
            </Button>
          </>
        }
      >
        <Field label="Resultado (opcional)" hint={task.customerName ? "Queda en el historial del cliente." : undefined}>
          {(p) => <textarea {...p} value={outcome} onChange={(e) => setOutcome(e.target.value)} rows={3} className={inputClass} placeholder="Atendió, pidió lista de precios para el lunes…" />}
        </Field>
      </Modal>
    </li>
  );
}
