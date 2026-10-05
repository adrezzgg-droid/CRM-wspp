"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FirebaseError } from "firebase/app";
import { sendPasswordResetEmail, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { firebaseClient } from "@/lib/firebase/client";

const AUTH_ERRORS: Record<string, string> = {
  "auth/invalid-credential": "Email o contraseña incorrectos.",
  "auth/invalid-email": "El email no es válido.",
  "auth/user-disabled": "Tu usuario está deshabilitado.",
  "auth/too-many-requests": "Demasiados intentos. Esperá unos minutos y volvé a probar.",
  "auth/network-request-failed": "No hay conexión. Revisá tu red.",
};

function messageFor(error: unknown): string {
  if (error instanceof FirebaseError) return AUTH_ERRORS[error.code] ?? "No se pudo iniciar sesión.";
  if (error instanceof Error) return error.message;
  return "No se pudo iniciar sesión.";
}

export function LoginForm({ next }: { next?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setInfo(null);
    const { auth } = firebaseClient();
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await cred.user.getIdToken(true);
      const res = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });
      const data = (await res.json().catch(() => ({}))) as { landing?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "No se pudo iniciar sesión.");
      router.replace(next ?? data.landing ?? "/");
      router.refresh();
    } catch (err) {
      await signOut(auth).catch(() => undefined);
      setError(messageFor(err));
      setBusy(false);
    }
  }

  async function onForgot() {
    setError(null);
    setInfo(null);
    if (!email.trim()) {
      setError("Escribí tu email y volvé a tocar “Olvidé mi contraseña”.");
      return;
    }
    try {
      await sendPasswordResetEmail(firebaseClient().auth, email.trim());
    } catch {
      // No revelamos si el email existe o no.
    }
    setInfo("Si el email está registrado, te enviamos un enlace para cambiar la contraseña.");
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-4" noValidate>
      <label className="block">
        <span className="text-sm font-medium">Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </label>
      <label className="block">
        <span className="text-sm font-medium">Contraseña</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {info && (
        <p role="status" className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          {info}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !email || !password}
        className="w-full rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Ingresando…" : "Ingresar"}
      </button>
      <button
        type="button"
        onClick={onForgot}
        className="w-full text-center text-sm text-brand-700 hover:underline"
      >
        Olvidé mi contraseña
      </button>
    </form>
  );
}
