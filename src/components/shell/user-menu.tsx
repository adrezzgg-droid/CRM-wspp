"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "firebase/auth";
import { LogOut } from "lucide-react";
import { firebaseClient } from "@/lib/firebase/client";
import type { ShellUser } from "./app-shell";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function UserMenu({ user }: { user: ShellUser }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function logout() {
    setBusy(true);
    await fetch("/api/auth/session", { method: "DELETE" }).catch(() => undefined);
    await signOut(firebaseClient().auth).catch(() => undefined);
    router.replace("/login");
    router.refresh();
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg p-1 pr-2 hover:bg-canvas"
      >
        <span className="grid size-8 place-items-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
          {initials(user.displayName) || "?"}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-40 truncate text-sm font-medium">{user.displayName}</span>
          <span className="block text-xs text-ink-muted">{user.roleLabel}</span>
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 mt-2 w-64 overflow-hidden rounded-xl border border-line bg-surface shadow-lg"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-medium">{user.displayName}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
            <p className="mt-1 text-xs text-ink-muted">Rol: {user.roleLabel}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            disabled={busy}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm hover:bg-canvas disabled:opacity-60"
          >
            <LogOut className="size-4" aria-hidden />
            {busy ? "Cerrando sesión…" : "Cerrar sesión"}
          </button>
        </div>
      )}
    </div>
  );
}
