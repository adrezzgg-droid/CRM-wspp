"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged, signInWithCustomToken, type User } from "firebase/auth";
import { firebaseClient } from "@/lib/firebase/client";

interface FirebaseSessionValue {
  uid: string;
  orgId: string;
  /** El SDK del navegador está autenticado como el mismo usuario de la cookie. */
  ready: boolean;
}

const FirebaseSessionContext = createContext<FirebaseSessionValue | null>(null);

/**
 * Mantiene el SDK del navegador alineado con la sesión del servidor. Si el
 * navegador perdió su sesión local (o tiene otro usuario), pide un custom
 * token a /api/auth/token. Las lecturas en tiempo real esperan a `ready`.
 */
export function FirebaseSessionProvider({
  uid,
  orgId,
  children,
}: {
  uid: string;
  orgId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { auth } = firebaseClient();
    let syncing = false;
    return onAuthStateChanged(auth, async (user: User | null) => {
      if (user?.uid === uid) {
        setReady(true);
        return;
      }
      setReady(false);
      if (syncing) return;
      syncing = true;
      try {
        const res = await fetch("/api/auth/token", { method: "POST" });
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        if (!res.ok) throw new Error(`token ${res.status}`);
        const { token } = (await res.json()) as { token: string };
        await signInWithCustomToken(auth, token);
      } catch (error) {
        console.error("No se pudo sincronizar la sesión del navegador", error);
      } finally {
        syncing = false;
      }
    });
  }, [uid, router]);

  return (
    <FirebaseSessionContext.Provider value={{ uid, orgId, ready }}>
      {children}
    </FirebaseSessionContext.Provider>
  );
}

export function useFirebaseSession(): FirebaseSessionValue {
  const value = useContext(FirebaseSessionContext);
  if (!value) throw new Error("useFirebaseSession fuera de FirebaseSessionProvider");
  return value;
}
