import type { CustomerStage } from "@/types/model";
import { CUSTOMER_STAGE_LABELS } from "@/types/model";

const STAGE_STYLES: Record<CustomerStage, string> = {
  prospecto: "bg-cyan-100 text-cyan-700",
  cliente_nuevo: "bg-brand-100 text-brand-600",
  cliente_activo: "bg-green-100 text-green-700",
  cliente_inactivo: "bg-amber-100 text-amber-700",
  cliente_perdido: "bg-slate-100 text-slate-500",
};

const BADGE = "inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold tracking-wide whitespace-nowrap uppercase";

export function StageBadge({ stage }: { stage: CustomerStage }) {
  return (
    <span className={`${BADGE} ${STAGE_STYLES[stage]}`}>
      {CUSTOMER_STAGE_LABELS[stage]}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "brand" | "warn" | "danger" }) {
  const tones = {
    neutral: "bg-slate-100 text-slate-500",
    brand: "bg-brand-100 text-brand-600",
    warn: "bg-amber-100 text-amber-700",
    danger: "bg-red-100 text-red-600",
  };
  return (
    <span className={`${BADGE} ${tones[tone]}`}>
      {children}
    </span>
  );
}

export function TagChip({ name, color }: { name: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-slate-200 bg-surface/70 px-2 py-0.5 text-[11px] font-semibold tracking-wide whitespace-nowrap uppercase">
      <span className="size-1.5 rounded-full" style={{ background: color }} aria-hidden />
      {name}
    </span>
  );
}
