import { Construction } from "lucide-react";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold sm:text-2xl">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6">{children}</div>;
}

/**
 * Módulo que todavía no se construyó. Lo dice explícitamente (con la fase del
 * plan) en vez de mostrar datos inventados.
 */
export function ModulePending({ phase, items }: { phase: number; items: string[] }) {
  return (
    <section className="rounded-xl border border-dashed border-line bg-surface p-6 sm:p-8">
      <div className="flex items-start gap-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-amber-100 text-amber-700">
          <Construction className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="font-medium">Este módulo se habilita en la Fase {phase}.</p>
          <p className="mt-1 text-sm text-ink-muted">
            El acceso y los permisos ya están activos. Lo que va a incluir:
          </p>
          <ul className="mt-3 grid gap-x-6 gap-y-1 text-sm text-ink-muted sm:grid-cols-2">
            {items.map((item) => (
              <li key={item} className="flex gap-2">
                <span aria-hidden className="text-brand-500">•</span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
