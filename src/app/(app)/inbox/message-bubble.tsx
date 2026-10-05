"use client";

import { AlertCircle, Check, CheckCheck, Clock, Download, FileText, MapPin, StickyNote, UserRound } from "lucide-react";
import type { Message } from "@/types/model";
import { formatBytes } from "./format";

function mediaUrl(conversationId: string, messageId: string, index: number, download = false) {
  return `/api/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/media?i=${index}${download ? "&descargar=1" : ""}`;
}

function StatusIcon({ status }: { status?: Message["status"] }) {
  const cls = "size-3.5 shrink-0";
  switch (status) {
    case "queued":
      return <Clock className={cls} aria-label="En cola" />;
    case "sent":
      return <Check className={cls} aria-label="Enviado" />;
    case "delivered":
      return <CheckCheck className={cls} aria-label="Entregado" />;
    case "read":
      return <CheckCheck className={`${cls} text-sky-500`} aria-label="Leído" />;
    case "failed":
      return <AlertCircle className={`${cls} text-red-600`} aria-label="No se pudo enviar" />;
    default:
      return null;
  }
}

function Attachments({ m }: { m: Message }) {
  return (
    <>
      {(m.attachments ?? []).map((a, i) => {
        if (!a.storagePath) {
          return (
            <p key={i} className="flex items-center gap-2 rounded-lg bg-black/5 px-3 py-2 text-xs">
              <FileText className="size-4" aria-hidden /> {a.fileName ?? "Archivo de WhatsApp"} · se descarga al conectar la cuenta (Fase 9)
            </p>
          );
        }
        const src = mediaUrl(m.conversationId, m.id, i);
        if (m.type === "image") {
          return (
            <a key={i} href={src} target="_blank" rel="noreferrer" className="block">
              {/* eslint-disable-next-line @next/next/no-img-element -- archivo privado servido por la API */}
              <img src={src} alt={a.caption ?? "Imagen"} loading="lazy" className="max-h-72 w-full max-w-72 rounded-lg bg-black/5 object-cover" />
            </a>
          );
        }
        if (m.type === "video") return <video key={i} src={src} controls preload="metadata" className="max-h-72 w-full max-w-72 rounded-lg bg-black" />;
        if (m.type === "audio") return <audio key={i} src={src} controls preload="metadata" className="w-64 max-w-full" />;
        return (
          <a key={i} href={mediaUrl(m.conversationId, m.id, i, true)} className="flex items-center gap-3 rounded-lg bg-black/5 px-3 py-2 hover:bg-black/10">
            <FileText className="size-6 shrink-0 text-brand-700" aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{a.fileName ?? "Documento"}</span>
              <span className="text-xs text-ink-muted">{formatBytes(a.size)}</span>
            </span>
            <Download className="size-4 shrink-0" aria-label="Descargar" />
          </a>
        );
      })}
    </>
  );
}

export function MessageBubble({ m, time, author }: { m: Message; time: string; author?: string }) {
  if (m.direction === "internal") {
    return (
      <div className="mx-auto w-full max-w-lg rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm">
        <p className="mb-0.5 flex items-center gap-1.5 text-[11px] font-semibold text-amber-800">
          <StickyNote className="size-3.5" aria-hidden /> Nota interna · {author ?? "Equipo"} · {time}
        </p>
        <p className="whitespace-pre-wrap">{m.text}</p>
      </div>
    );
  }

  const out = m.direction === "out";
  const hasMedia = !!m.attachments?.length;
  return (
    <div className={`flex ${out ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] space-y-1.5 rounded-2xl px-3 py-2 text-sm shadow-sm sm:max-w-[70%] ${out ? "rounded-br-sm bg-brand-100 text-ink" : "rounded-bl-sm bg-surface"}`}>
        {out && author && <p className="text-[11px] font-semibold text-brand-800">{author}</p>}

        {hasMedia && <Attachments m={m} />}

        {m.type === "location" && m.location && (
          <a
            href={`https://www.google.com/maps?q=${m.location.lat},${m.location.lng}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-start gap-2 rounded-lg bg-black/5 px-3 py-2 hover:bg-black/10"
          >
            <MapPin className="mt-0.5 size-4 shrink-0 text-red-600" aria-hidden />
            <span>
              <span className="block font-medium">{m.location.name ?? "Ubicación"}</span>
              {m.location.address && <span className="block text-xs text-ink-muted">{m.location.address}</span>}
              <span className="text-xs text-brand-700">Ver en el mapa</span>
            </span>
          </a>
        )}

        {m.type === "contacts" &&
          m.sharedContacts?.map((c, i) => (
            <div key={i} className="flex items-start gap-2 rounded-lg bg-black/5 px-3 py-2">
              <UserRound className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                <span className="block font-medium">{c.name}</span>
                <span className="text-xs text-ink-muted">{c.phones.join(", ") || "Sin teléfono"}</span>
              </span>
            </div>
          ))}

        {(m.type === "button_reply" || m.type === "list_reply") && m.interactive ? (
          <p className="inline-flex items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-2.5 py-0.5 text-xs font-medium text-brand-800">
            ↩ {m.interactive.title}
          </p>
        ) : (
          m.text && !(m.type === "location" || m.type === "contacts") && <p className="break-words whitespace-pre-wrap">{m.text}</p>
        )}

        <p className={`flex items-center justify-end gap-1 text-[10px] ${out ? "text-brand-900/60" : "text-ink-muted"}`}>
          {time}
          {out && <StatusIcon status={m.status} />}
        </p>
        {m.status === "failed" && <p className="text-[11px] text-red-700">No se pudo enviar{m.errorCode ? ` (código ${m.errorCode})` : ""}.</p>}
      </div>
    </div>
  );
}
