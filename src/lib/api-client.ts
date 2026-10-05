"use client";

/** Error de la API con los mensajes por campo (si los hubo). */
export class ApiClientError extends Error {
  readonly status: number;
  readonly fieldErrors: Record<string, string>;
  readonly details: unknown;
  constructor(status: number, message: string, details: unknown) {
    super(message);
    this.status = status;
    this.details = details;
    this.fieldErrors = {};
    if (Array.isArray(details)) {
      for (const issue of details as { path?: unknown[]; message?: string }[]) {
        const key = issue.path?.[0];
        if (typeof key === "string" && issue.message && !this.fieldErrors[key]) this.fieldErrors[key] = issue.message;
      }
    }
  }
}

export async function api<T = unknown>(method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", url: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiClientError(0, "No hay conexión con el servidor.", null);
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string; details?: unknown };
  if (!res.ok) throw new ApiClientError(res.status, data.error ?? `Error ${res.status}`, data.details);
  return data as T;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado.";
}
