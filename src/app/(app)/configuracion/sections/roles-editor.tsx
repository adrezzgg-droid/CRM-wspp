"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ACTIONS, RESOURCES, ROLE_LABELS, type Action, type PolicyOverrides, type Resource, type Scope } from "@/server/permissions/matrix";
import {
  ACTION_LABELS,
  EDITABLE_ROLES,
  RESOURCE_LABELS,
  SCOPE_LABELS,
  fullPolicy,
  overridesFor,
  type EditableRole,
  type FullPolicy,
} from "@/server/permissions/overrides";
import { api, errorMessage } from "@/lib/api-client";
import { Alert, Button } from "@/components/ui/controls";
import { inputClass } from "@/components/ui/styles";

/** Recursos donde el alcance (propio/equipo/todo) tiene sentido. */
const SCOPED: ReadonlySet<Resource> = new Set(["dashboard", "inbox", "clientes", "pipeline", "pedidos", "tareas", "equipos"]);

export function RolesEditor({ overrides, readOnly }: { overrides: PolicyOverrides; readOnly: boolean }) {
  const router = useRouter();
  const initial = useMemo(
    () => Object.fromEntries(EDITABLE_ROLES.map((r) => [r, fullPolicy(r, overrides)])) as Record<EditableRole, FullPolicy>,
    [overrides],
  );
  const [policies, setPolicies] = useState(initial);
  const [role, setRole] = useState<EditableRole | "admin">("vendedor");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "error" | "success"; text: string } | null>(null);

  const policy = role === "admin" ? fullPolicy("admin") : policies[role];
  const locked = readOnly || role === "admin";
  const dirty = JSON.stringify(policies) !== JSON.stringify(initial);

  function toggle(resource: Resource, action: Action, on: boolean) {
    if (role === "admin") return;
    setPolicies((p) => {
      const g = p[role][resource];
      let actions = on ? [...g.actions, action] : g.actions.filter((a) => a !== action);
      // Sin "ver" no tiene sentido ninguna otra acción.
      if (action === "ver" && !on) actions = [];
      if (action !== "ver" && on && !actions.includes("ver")) actions.push("ver");
      return { ...p, [role]: { ...p[role], [resource]: { ...g, actions: ACTIONS.filter((a) => actions.includes(a)) } } };
    });
  }

  function setScope(resource: Resource, scope: Scope) {
    if (role === "admin") return;
    setPolicies((p) => ({ ...p, [role]: { ...p[role], [resource]: { ...p[role][resource], scope } } }));
  }

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      const next = Object.fromEntries(
        EDITABLE_ROLES.map((r) => [r, overridesFor(r, policies[r])]).filter(([, o]) => Object.keys(o as object).length > 0),
      );
      await api("PUT", "/api/settings/permissions", { overrides: next });
      setMessage({ tone: "success", text: "Permisos guardados. Se aplican en la próxima acción de cada usuario." });
      router.refresh();
    } catch (err) {
      setMessage({ tone: "error", text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }

  function resetRole() {
    if (role === "admin") return;
    setPolicies((p) => ({ ...p, [role]: fullPolicy(role) }));
  }

  return (
    <div className="space-y-4">
      {readOnly && <Alert tone="info">Solo un administrador puede cambiar los permisos.</Alert>}
      <div role="tablist" aria-label="Rol" className="-mx-1 flex gap-1 overflow-x-auto px-1">
        {(["admin", ...EDITABLE_ROLES] as const).map((r) => (
          <button
            key={r}
            role="tab"
            type="button"
            aria-selected={role === r}
            onClick={() => setRole(r)}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-sm whitespace-nowrap ${role === r ? "bg-brand-600 font-medium text-white" : "bg-surface text-ink-muted hover:text-ink"}`}
          >
            {ROLE_LABELS[r]}
          </button>
        ))}
      </div>

      {role === "admin" && <Alert tone="info">El administrador siempre tiene todos los permisos: no se puede restringir, así la empresa nunca se queda sin alguien que corrija la configuración.</Alert>}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="border-b border-line bg-canvas text-xs text-ink-muted">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Módulo</th>
              {ACTIONS.map((a) => (
                <th key={a} className="px-2 py-2 text-center font-medium">
                  {ACTION_LABELS[a]}
                </th>
              ))}
              <th className="px-3 py-2 text-left font-medium">Alcance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {RESOURCES.map((r) => {
              const g = policy[r];
              return (
                <tr key={r} className={g.actions.length ? "" : "text-ink-muted"}>
                  <th scope="row" className="px-3 py-2 text-left font-medium">
                    {RESOURCE_LABELS[r]}
                  </th>
                  {ACTIONS.map((a) => (
                    <td key={a} className="px-2 py-2 text-center">
                      <input
                        type="checkbox"
                        className="size-4 accent-brand-600"
                        checked={g.actions.includes(a)}
                        disabled={locked}
                        onChange={(e) => toggle(r, a, e.target.checked)}
                        aria-label={`${RESOURCE_LABELS[r]}: ${ACTION_LABELS[a]}`}
                      />
                    </td>
                  ))}
                  <td className="px-3 py-1.5">
                    {SCOPED.has(r) && g.actions.length > 0 ? (
                      <select
                        value={g.scope}
                        disabled={locked}
                        onChange={(e) => setScope(r, e.target.value as Scope)}
                        className={`${inputClass} py-1`}
                        aria-label={`Alcance en ${RESOURCE_LABELS[r]}`}
                      >
                        {(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => (
                          <option key={s} value={s}>
                            {SCOPE_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs text-ink-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {!readOnly && (
        <div className="space-y-2">
          {message && <Alert tone={message.tone}>{message.text}</Alert>}
          <div className="flex flex-wrap justify-end gap-2">
            {role !== "admin" && (
              <Button variant="ghost" onClick={resetRole}>
                Restaurar valores por defecto de {ROLE_LABELS[role]}
              </Button>
            )}
            <Button onClick={save} loading={busy} disabled={!dirty}>
              Guardar permisos
            </Button>
          </div>
          <p className="text-xs text-ink-muted">
            Los permisos controlan qué ve y qué puede hacer cada rol en el CRM. Las reglas de la base de datos siguen siendo el límite máximo:
            por ejemplo, un repartidor nunca puede leer conversaciones en tiempo real aunque se le otorgue la bandeja.
          </p>
        </div>
      )}
    </div>
  );
}
