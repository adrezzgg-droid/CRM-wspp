"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { collection, doc, limit, onSnapshot, orderBy, query, updateDoc, where } from "firebase/firestore";
import { Bell } from "lucide-react";
import type { Notification } from "@/types/model";
import { firebaseClient } from "@/lib/firebase/client";
import { orgPath } from "@/types/model";
import { useFirebaseSession } from "@/components/providers/firebase-session";

const MAX = 99;
const LIST = 15;

const ago = new Intl.RelativeTimeFormat("es-AR", { numeric: "auto" });
function timeAgo(ms: number, now: number): string {
  const min = Math.round((ms - now) / 60_000);
  if (Math.abs(min) < 60) return ago.format(min, "minute");
  const h = Math.round(min / 60);
  if (Math.abs(h) < 24) return ago.format(h, "hour");
  return ago.format(Math.round(h / 24), "day");
}

/**
 * Notificaciones en tiempo real. Lee directo de Firestore (las reglas solo
 * devuelven las propias) y lo único que puede escribir es la marca de leída.
 */
export function NotificationBell() {
  const router = useRouter();
  const { uid, orgId, ready } = useFirebaseSession();
  const [unread, setUnread] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [now, setNow] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const col = () => collection(firebaseClient().db, orgPath(orgId, "notifications"));

  useEffect(() => {
    if (!ready) return;
    const q = query(collection(firebaseClient().db, orgPath(orgId, "notifications")), where("userId", "==", uid), where("read", "==", false), limit(MAX + 1));
    return onSnapshot(
      q,
      (snap) => setUnread(snap.size),
      (error) => console.error("No se pudieron leer las notificaciones", error),
    );
  }, [ready, uid, orgId]);

  useEffect(() => {
    if (!ready || !open) return;
    const q = query(collection(firebaseClient().db, orgPath(orgId, "notifications")), where("userId", "==", uid), orderBy("createdAt", "desc"), limit(LIST));
    return onSnapshot(
      q,
      (snap) => setItems(snap.docs.map((d) => ({ ...(d.data() as Notification), id: d.id }))),
      (error) => console.error("No se pudieron leer las notificaciones", error),
    );
  }, [ready, open, uid, orgId]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const markRead = (n: Notification) => (n.read ? Promise.resolve() : updateDoc(doc(col(), n.id), { read: true }).catch(() => undefined));

  async function openItem(n: Notification) {
    await markRead(n);
    setOpen(false);
    if (n.link?.startsWith("/")) router.push(n.link);
  }

  const label = unread === null ? "Notificaciones" : `Notificaciones: ${unread > MAX ? `más de ${MAX}` : unread} sin leer`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => {
          setNow(Date.now());
          setOpen((o) => !o);
        }}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        className="relative inline-flex rounded-lg p-2 text-ink-muted hover:bg-canvas"
      >
        <Bell className="size-5" aria-hidden />
        {!!unread && (
          <span className="absolute top-1 right-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 font-semibold text-white">
            {unread > MAX ? `${MAX}+` : unread}
          </span>
        )}
      </button>
      {open && (
        <div role="dialog" aria-label="Notificaciones" className="absolute right-0 z-30 mt-2 w-[22rem] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <p className="text-sm font-semibold">Notificaciones</p>
            {!!unread && items && (
              <button type="button" onClick={() => items.forEach(markRead)} className="text-xs font-medium text-brand-700 hover:underline">
                Marcar todas como leídas
              </button>
            )}
          </div>
          <ul className="max-h-96 divide-y divide-line overflow-y-auto">
            {!items ? (
              <li className="px-4 py-6 text-center text-sm text-ink-muted">Cargando…</li>
            ) : items.length === 0 ? (
              <li className="px-4 py-6 text-center text-sm text-ink-muted">No tenés notificaciones.</li>
            ) : (
              items.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => openItem(n)} className={`flex w-full gap-2 px-4 py-2.5 text-left hover:bg-canvas ${n.read ? "" : "bg-brand-50/60"}`}>
                    <span className={`mt-1.5 size-2 shrink-0 rounded-full ${n.read ? "bg-transparent" : "bg-brand-500"}`} aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className={`block text-sm ${n.read ? "" : "font-medium"}`}>{n.title}</span>
                      {n.body && <span className="block truncate text-xs text-ink-muted">{n.body}</span>}
                      <span className="text-[11px] text-ink-muted">{timeAgo(n.createdAt, now)}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
