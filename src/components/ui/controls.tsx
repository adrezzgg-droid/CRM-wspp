"use client";

import { useEffect, useId, useRef } from "react";
import { Loader2, X } from "lucide-react";

export { inputClass } from "./styles";

export function Field({
  label,
  error,
  hint,
  className = "",
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  className?: string;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => React.ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm font-medium">
        {label}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {error ? (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1 text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700",
  secondary: "border border-line bg-surface text-ink hover:bg-canvas",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-ink-muted hover:bg-canvas hover:text-ink",
};

export function Button({
  variant = "primary",
  loading,
  className = "",
  children,
  disabled,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; loading?: boolean }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function Alert({ tone = "error", children }: { tone?: "error" | "info" | "success"; children: React.ReactNode }) {
  const tones = {
    error: "bg-red-50 text-red-700",
    info: "bg-brand-50 text-brand-800",
    success: "bg-green-50 text-green-800",
  };
  const ref = useRef<HTMLDivElement>(null);
  // Un error que aparece fuera de la vista (p.ej. arriba de un formulario largo) se trae a la vista.
  useEffect(() => {
    if (tone === "error") ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [tone, children]);
  return (
    <div ref={ref} role={tone === "error" ? "alert" : "status"} className={`rounded-lg px-3 py-2 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

/** Ventana modal accesible: foco inicial, Escape para cerrar, scroll interno en pantallas chicas. */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "md" | "lg";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  // onClose suele llegar como función nueva en cada render: se guarda en un ref
  // para que el efecto de apertura (foco inicial) corra una sola vez.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-close])")?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCloseRef.current();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button type="button" aria-label="Cerrar" className="absolute inset-0 bg-black/40" onClick={onClose} tabIndex={-1} />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={`relative flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-surface shadow-xl sm:rounded-2xl ${size === "lg" ? "sm:max-w-3xl" : "sm:max-w-lg"}`}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 id={titleId} className="text-base font-semibold">
            {title}
          </h2>
          <button type="button" data-close onClick={onClose} className="rounded-lg p-1.5 text-ink-muted hover:bg-canvas" aria-label="Cerrar">
            <X className="size-5" aria-hidden />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

/** Selección múltiple compacta con casillas (etiquetas, equipos, zonas...). */
export function CheckboxGroup({
  options,
  value,
  onChange,
  disabled,
  empty = "No hay opciones.",
}: {
  options: { id: string; label: string; color?: string }[];
  value: string[];
  onChange: (v: string[]) => void;
  disabled?: boolean;
  empty?: string;
}) {
  if (!options.length) return <p className="text-sm text-ink-muted">{empty}</p>;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const checked = value.includes(o.id);
        return (
          <label
            key={o.id}
            className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition ${checked ? "border-brand-500 bg-brand-50 text-brand-900" : "border-line text-ink-muted hover:bg-canvas"} ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={checked}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? [...value, o.id] : value.filter((x) => x !== o.id))}
            />
            {o.color && <span className="size-2 rounded-full" style={{ background: o.color }} aria-hidden />}
            {o.label}
          </label>
        );
      })}
    </div>
  );
}
