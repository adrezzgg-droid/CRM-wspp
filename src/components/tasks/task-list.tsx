"use client";

import type { Task } from "@/types/model";
import { useNow } from "@/lib/use-now";
import { TaskItem } from "./task-item";
import type { TaskFormOptions } from "./task-form";

/** Lista de tareas con la hora actualizada cada minuto (para marcar las vencidas). */
export function TaskList({
  tasks,
  timezone,
  canEdit,
  options,
  uid,
  names,
  empty,
}: {
  tasks: Task[];
  timezone: string;
  canEdit: boolean;
  options: TaskFormOptions | null;
  uid: string;
  names: Record<string, string>;
  empty: string;
}) {
  const now = useNow();
  if (!tasks.length) return <p className="rounded-xl border border-dashed border-line bg-surface px-6 py-8 text-center text-sm text-ink-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {tasks.map((t) => (
        <TaskItem key={t.id} task={t} now={now} timezone={timezone} canEdit={canEdit} options={options} assigneeName={t.assigneeId !== uid ? names[t.assigneeId] ?? "—" : undefined} />
      ))}
    </ul>
  );
}
