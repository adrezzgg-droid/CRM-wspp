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
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <label className="block">
        <span className="text-sm font-semibold text-[#e2e8f0]">Email</span>
        <input
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-[#33406a] bg-[#121830] px-3 py-2.5 text-sm text-[#f1f5f9] outline-none focus:border-cyan-400 focus:ring-[3px] focus:ring-cyan-400/20"
        />
      </label>
      <label className="block">
        <span className="text-sm font-semibold text-[#e2e8f0]">Contraseña</span>
        <input
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full rounded-lg border border-[#33406a] bg-[#121830] px-3 py-2.5 text-sm text-[#f1f5f9] outline-none focus:border-cyan-400 focus:ring-[3px] focus:ring-cyan-400/20"
        />
      </label>

      {error && (
        <p role="alert" className="rounded-lg bg-red-500/15 px-3 py-2 text-sm text-red-200">
          {error}
        </p>
      )}
      {info && (
        <p role="status" className="rounded-lg bg-[#818cf8]/15 px-3 py-2 text-sm text-[#e0e7ff]">
          {info}
        </p>
      )}

      <button
        type="submit"
        disabled={busy || !email || !password}
        className="w-full rounded-lg border border-[rgba(129,140,248,0.55)] px-4 py-2.5 text-sm font-semibold text-[#f1f5f9] shadow-[0_0_0_1px_rgba(34,211,238,0.15),0_6px_18px_rgba(0,0,0,0.35)] disabled:cursor-not-allowed disabled:opacity-60"
        style={{ background: "radial-gradient(260px 80px at 50% -30%, rgba(129,140,248,0.55), transparent 70%), linear-gradient(160deg, #343A7A, #25295A)" }}
      >
        {busy ? "Ingresando…" : "Ingresar"}
      </button>
      <button
        type="button"
        onClick={onForgot}
        className="w-full text-center text-sm text-[#a5b4fc] hover:underline"
      >
        Olvidé mi contraseña
      </button>
    </form>
  );
}
