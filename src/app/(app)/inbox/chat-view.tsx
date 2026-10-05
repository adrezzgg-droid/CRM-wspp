"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { collection, limitToLast, onSnapshot, orderBy, query } from "firebase/firestore";
import { ArrowLeft, Info, Paperclip, Send, StickyNote, X } from "lucide-react";
import type { Conversation, Message } from "@/types/model";
import { CONVERSATION_STATUS_LABELS, orgPath } from "@/types/model";
import { firebaseClient } from "@/lib/firebase/client";
import { formatWhatsappId } from "@/lib/phone";
import { isWindowOpen } from "@/lib/whatsapp/webhook";
import { api, errorMessage } from "@/lib/api-client";
import { useFirebaseSession } from "@/components/providers/firebase-session";
import { Alert } from "@/components/ui/controls";
import { MessageBubble } from "./message-bubble";
import { initials, makeFormatters, formatBytes } from "./format";
import type { InboxProps } from "./types";

const PAGE = 150;

export function ChatView({
  props,
  conversation: c,
  names,
  onBack,
  onOpenPanel,
}: {
  props: InboxProps;
  conversation: Conversation;
  names: Map<string, string>;
  onBack: () => void;
  onOpenPanel: () => void;
}) {
  const { ready } = useFirebaseSession();
  const fmt = useMemo(() => makeFormatters(props.timezone), [props.timezone]);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Mensajes en tiempo real (los últimos PAGE).
  useEffect(() => {
    if (!ready) return;
    const q = query(collection(firebaseClient().db, `${orgPath(props.orgId, "conversations")}/${c.id}/messages`), orderBy("timestamp"), limitToLast(PAGE));
    return onSnapshot(
      q,
      (snap) => setMessages(snap.docs.map((d) => ({ ...(d.data() as Message), id: d.id }))),
      (err) => {
        console.error("[bandeja] mensajes", err);
        setLoadError("No se pudieron cargar los mensajes.");
      },
    );
  }, [ready, props.orgId, c.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages?.length]);

  // Marcar como leída al abrirla (solo cuenta para quien la atiende).
  const shouldMarkRead = c.unreadCount > 0 && (c.assigneeId === props.uid || (!c.assigneeId && props.canAssign));
  useEffect(() => {
    if (shouldMarkRead) api("POST", `/api/conversations/${c.id}/read`).catch(() => undefined);
  }, [shouldMarkRead, c.id, c.unreadCount]);

  const windowOpen = isWindowOpen(c.serviceWindowEndsAt);

  return (
    <>
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line bg-surface px-2 sm:px-3">
        <button type="button" onClick={onBack} className="rounded-lg p-2 text-ink-muted hover:bg-canvas md:hidden" aria-label="Volver a la lista">
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800" aria-hidden>
          {initials(c.contactName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{c.contactName}</p>
          <p className="truncate text-xs text-ink-muted">
            {formatWhatsappId(c.waContactId)} · {CONVERSATION_STATUS_LABELS[c.status]} · {c.assigneeId ? names.get(c.assigneeId) ?? "—" : "Sin asignar"}
          </p>
        </div>
        <button type="button" onClick={onOpenPanel} className="rounded-lg p-2 text-ink-muted hover:bg-canvas xl:hidden" aria-label="Ver ficha del cliente">
          <Info className="size-5" aria-hidden />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6" aria-live="polite">
        {loadError ? (
          <Alert>{loadError}</Alert>
        ) : !messages ? (
          <p className="text-center text-sm text-ink-muted">Cargando mensajes…</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-sm text-ink-muted">Sin mensajes.</p>
        ) : (
          <div className="mx-auto max-w-3xl space-y-2">
            {messages.length >= PAGE && <p className="text-center text-xs text-ink-muted">Se muestran los últimos {PAGE} mensajes.</p>}
            {messages.map((m, i) => {
              const newDay = i === 0 || fmt.dayKey(messages[i - 1].timestamp) !== fmt.dayKey(m.timestamp);
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <p className="py-2 text-center">
                      <span className="rounded-full bg-surface px-3 py-1 text-[11px] font-medium text-ink-muted shadow-sm">{fmt.dayLabel(m.timestamp)}</span>
                    </p>
                  )}
                  <MessageBubble m={m} time={fmt.time(m.timestamp)} author={m.senderId && m.senderId !== "customer" ? names.get(m.senderId) : undefined} />
                </Fragment>
              );
            })}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {props.canEdit ? (
        <Composer conversationId={c.id} windowOpen={windowOpen} closed={c.status === "cerrada"} />
      ) : (
        <p className="border-t border-line bg-surface px-4 py-3 text-center text-xs text-ink-muted">Tu rol solo permite ver las conversaciones.</p>
      )}
    </>
  );
}

function Composer({ conversationId, windowOpen, closed }: { conversationId: string; windowOpen: boolean; closed: boolean }) {
  const [text, setText] = useState("");
  const [note, setNote] = useState(!windowOpen);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const blocked = !note && !windowOpen;

  async function send() {
    if (busy || (!text.trim() && !file)) return;
    setBusy(true);
    setError(null);
    try {
      if (file) {
        const form = new FormData();
        form.set("file", file);
        if (text.trim()) form.set("caption", text.trim());
        const res = await fetch(`/api/conversations/${conversationId}/attachments`, { method: "POST", body: form });
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(data.error ?? "No se pudo enviar el archivo.");
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
      } else {
        await api("POST", `/api/conversations/${conversationId}/messages`, { text, note });
      }
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={`shrink-0 border-t border-line px-2 py-2 sm:px-4 ${note ? "bg-amber-50" : "bg-surface"}`}>
      {!windowOpen && !note && (
        <p className="mb-2 rounded-lg bg-amber-100 px-3 py-2 text-xs text-amber-900">
          Pasaron más de 24 h desde el último mensaje del cliente: WhatsApp solo permite escribirle con una plantilla aprobada (Fase 7). Podés dejar una nota interna.
        </p>
      )}
      {closed && <p className="mb-2 text-xs text-ink-muted">La conversación está cerrada. Si respondés, vuelve a quedar en atención.</p>}
      {error && <div className="mb-2"><Alert>{error}</Alert></div>}
      {file && (
        <p className="mb-2 flex items-center gap-2 rounded-lg bg-canvas px-3 py-1.5 text-xs">
          <Paperclip className="size-3.5" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {file.name} · {formatBytes(file.size)} {text.trim() && "· el texto va como descripción"}
          </span>
          <button type="button" onClick={() => setFile(null)} aria-label="Quitar archivo" className="rounded p-0.5 hover:bg-line">
            <X className="size-3.5" aria-hidden />
          </button>
        </p>
      )}
      <div className="flex items-end gap-1.5">
        <button
          type="button"
          onClick={() => setNote((n) => !n)}
          aria-pressed={note}
          title={note ? "Nota interna (el cliente no la ve)" : "Cambiar a nota interna"}
          className={`rounded-lg p-2 ${note ? "bg-amber-200 text-amber-900" : "text-ink-muted hover:bg-canvas"}`}
        >
          <StickyNote className="size-5" aria-hidden />
          <span className="sr-only">Nota interna</span>
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={note || blocked}
          title={note ? "Las notas internas no llevan archivos" : "Adjuntar archivo"}
          className="rounded-lg p-2 text-ink-muted hover:bg-canvas disabled:opacity-40"
        >
          <Paperclip className="size-5" aria-hidden />
          <span className="sr-only">Adjuntar archivo</span>
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          accept="image/jpeg,image/png,video/mp4,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <label htmlFor="composer" className="sr-only">
          {note ? "Nota interna" : "Mensaje"}
        </label>
        <textarea
          id="composer"
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          disabled={blocked}
          placeholder={note ? "Nota interna para el equipo…" : blocked ? "Fuera de la ventana de 24 h" : "Escribí un mensaje (Enter envía, Shift+Enter salto de línea)"}
          className="max-h-40 min-h-10 flex-1 resize-none rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 disabled:bg-canvas"
          style={{ fieldSizing: "content" } as React.CSSProperties}
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || blocked || (!text.trim() && !file)}
          className={`rounded-xl p-2.5 text-white disabled:opacity-50 ${note ? "bg-amber-600 hover:bg-amber-700" : "bg-brand-600 hover:bg-brand-700"}`}
          aria-label={note ? "Guardar nota" : "Enviar"}
        >
          <Send className="size-5" aria-hidden />
        </button>
      </div>
    </div>
  );
}
