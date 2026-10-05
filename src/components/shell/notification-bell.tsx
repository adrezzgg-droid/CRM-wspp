"use client";

import { useEffect, useState } from "react";
import { collection, limit, onSnapshot, query, where } from "firebase/firestore";
import { Bell } from "lucide-react";
import { firebaseClient } from "@/lib/firebase/client";
import { orgPath } from "@/types/model";
import { useFirebaseSession } from "@/components/providers/firebase-session";

const MAX = 99;

/**
 * Contador de notificaciones sin leer, en tiempo real. Lee directo de
 * Firestore con el SDK del navegador; las reglas solo devuelven las propias.
 */
export function NotificationBell() {
  const { uid, orgId, ready } = useFirebaseSession();
  const [unread, setUnread] = useState<number | null>(null);

  useEffect(() => {
    if (!ready) return;
    const q = query(
      collection(firebaseClient().db, orgPath(orgId, "notifications")),
      where("userId", "==", uid),
      where("read", "==", false),
      limit(MAX + 1),
    );
    return onSnapshot(
      q,
      (snap) => setUnread(snap.size),
      (error) => {
        console.error("No se pudieron leer las notificaciones", error);
        setUnread(null);
      },
    );
  }, [ready, uid, orgId]);

  const label =
    unread === null ? "Notificaciones" : `Notificaciones: ${unread > MAX ? `más de ${MAX}` : unread} sin leer`;

  return (
    <span className="relative inline-flex rounded-lg p-2 text-ink-muted" title={label} aria-label={label} role="img">
      <Bell className="size-5" aria-hidden />
      {!!unread && (
        <span className="absolute top-1 right-1 min-w-4 rounded-full bg-red-600 px-1 text-center text-[10px] leading-4 font-semibold text-white">
          {unread > MAX ? `${MAX}+` : unread}
        </span>
      )}
    </span>
  );
}
