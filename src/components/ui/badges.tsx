import type { CustomerStage } from "@/types/model";
import { CUSTOMER_STAGE_LABELS } from "@/types/model";

const STAGE_STYLES: Record<CustomerStage, string> = {
  prospecto: "bg-sky-50 text-sky-700 ring-sky-200",
  cliente_nuevo: "bg-violet-50 text-violet-700 ring-violet-200",
  cliente_activo: "bg-green-50 text-green-700 ring-green-200",
  cliente_inactivo: "bg-amber-50 text-amber-800 ring-amber-200",
  cliente_perdido: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function StageBadge({ stage }: { stage: CustomerStage }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${STAGE_STYLES[stage]}`}>
      {CUSTOMER_STAGE_LABELS[stage]}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "brand" | "warn" | "danger" }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-700 ring-slate-200",
    brand: "bg-brand-50 text-brand-800 ring-brand-200",
    warn: "bg-amber-50 text-amber-800 ring-amber-200",
    danger: "bg-red-50 text-red-700 ring-red-200",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function TagChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium whitespace-nowrap">
      <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {name}
    </span>
  );
}
