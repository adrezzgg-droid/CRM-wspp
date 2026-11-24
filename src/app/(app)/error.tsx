"use client";

import { useEffect } from "react";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="grid min-h-full place-items-center p-6">
      <div className="max-w-sm text-center">
        <h1 className="text-lg font-semibold">Algo salió mal</h1>
        <p className="mt-1 text-sm text-ink-muted">
          No pudimos cargar esta sección. Probá de nuevo; si sigue fallando, avisale al administrador.
        </p>
        {error.digest && <p className="mt-2 font-mono text-xs text-ink-muted">Código: {error.digest}</p>}
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-lg btn-primario px-4 py-2 text-sm"
        >
          Reintentar
        </button>
      </div>
    </div>
  );
}
