"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { collection, doc, limit, onSnapshot, orderBy, query, where, type QueryConstraint } from "firebase/firestore";
import type { Conversation } from "@/types/model";
import { orgPath } from "@/types/model";
import { firebaseClient } from "@/lib/firebase/client";
import { inboxQuery, isInboxFilter, type InboxFilter } from "@/lib/inbox-filters";
import { useFirebaseSession } from "@/components/providers/firebase-session";
import { ConversationList } from "./conversation-list";
import { ChatView } from "./chat-view";
import { ConversationPanel } from "./conversation-panel";
import type { InboxProps } from "./types";

const PAGE = 100;

/**
 * Bandeja en tres paneles:
 *  - xl:   lista | chat | ficha
 *  - md:   lista | chat (ficha en panel deslizable)
 *  - móvil: una vista a la vez (lista → chat → ficha)
 */
export function InboxApp(props: InboxProps) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { ready } = useFirebaseSession();

  const selectedId = params.get("c");
  const filterParam = params.get("f");
  const filter: InboxFilter = isInboxFilter(filterParam) ? filterParam : props.scope === "propio" ? "mias" : "todos";

  // Resultados guardados junto con la consulta que los produjo: al cambiar de
  // filtro, lo anterior deja de mostrarse sin tener que vaciarlo a mano.
  const [listResult, setListResult] = useState<{ key: string; items: Conversation[]; error: string | null } | null>(null);
  const [selectedResult, setSelectedResult] = useState<{ id: string; conversation: Conversation | null } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);

  const spec = useMemo(() => inboxQuery(filter, { uid: props.uid, scope: props.scope }), [filter, props.uid, props.scope]);
  const listKey = filter;
  const current = listResult?.key === listKey ? listResult : null;
  const items = spec && current ? current.items : [];
  const error = current?.error ?? null;
  const loading = !!spec && !current;
  const selected = selectedId && selectedResult?.id === selectedId ? selectedResult.conversation : null;

  function navigate(next: { c?: string | null; f?: InboxFilter }) {
    const sp = new URLSearchParams(params.toString());
    if (next.c !== undefined) {
      if (next.c) sp.set("c", next.c);
      else sp.delete("c");
    }
    if (next.f) sp.set("f", next.f);
    router.replace(`${pathname}?${sp}`, { scroll: false });
  }

  // Lista en tiempo real según el filtro.
  useEffect(() => {
    if (!ready || !spec) return;
    const constraints: QueryConstraint[] = spec.clauses.map(([f, op, v]) => where(f, op, v));
    const q = query(collection(firebaseClient().db, orgPath(props.orgId, "conversations")), ...constraints, orderBy("lastMessageAt", "desc"), limit(PAGE));
    const team = new Set(props.teamUids);
    const myTeams = new Set(props.myTeamIds);
    return onSnapshot(
      q,
      (snap) => {
        let rows = snap.docs.map((d) => ({ ...(d.data() as Conversation), id: d.id }));
        // Supervisor: lo de su gente, y lo sin asignar que es de sus equipos o de ninguno.
        if (spec.teamOnly) rows = rows.filter((c) => (c.assigneeId ? team.has(c.assigneeId) : !c.teamId || myTeams.has(c.teamId)));
        setListResult({ key: listKey, items: rows, error: null });
      },
      (err) => {
        console.error("[bandeja] lista", err);
        const message = err.code === "failed-precondition" ? "Falta un índice en la base para este filtro. Avisale al administrador." : "No se pudo cargar la bandeja.";
        setListResult({ key: listKey, items: [], error: message });
      },
    );
  }, [ready, spec, listKey, props.orgId, props.teamUids, props.myTeamIds]);

  // Conversación seleccionada en tiempo real (aunque no esté en el filtro actual).
  useEffect(() => {
    if (!ready || !selectedId) return;
    return onSnapshot(
      doc(firebaseClient().db, orgPath(props.orgId, "conversations"), selectedId),
      (snap) => setSelectedResult({ id: selectedId, conversation: snap.exists() ? { ...(snap.data() as Conversation), id: snap.id } : null }),
      () => setSelectedResult({ id: selectedId, conversation: null }),
    );
  }, [ready, selectedId, props.orgId]);

  const names = useMemo(() => new Map(props.members.map((m) => [m.id, m.name])), [props.members]);
  const tags = useMemo(() => new Map(props.tags.map((t) => [t.id, t])), [props.tags]);

  return (
    <div className="flex h-full min-h-0">
      {/* Lista */}
      <section
        aria-label="Conversaciones"
        className={`${selectedId ? "hidden md:flex" : "flex"} w-full min-w-0 flex-col border-r border-line bg-surface md:w-80 md:shrink-0 lg:w-96`}
      >
        <ConversationList
          props={props}
          filter={filter}
          onFilter={(f) => navigate({ f })}
          items={items}
          loading={loading || !ready}
          error={error}
          selectedId={selectedId}
          onSelect={(id) => {
            setPanelOpen(false);
            navigate({ c: id });
          }}
          names={names}
          tags={tags}
        />
      </section>

      {/* Chat */}
      <section aria-label="Chat" className={`${selectedId ? "flex" : "hidden md:flex"} min-w-0 flex-1 flex-col bg-canvas`}>
        {selectedId && selected ? (
          <ChatView
            key={selected.id}
            props={props}
            conversation={selected}
            names={names}
            onBack={() => navigate({ c: null })}
            onOpenPanel={() => setPanelOpen(true)}
          />
        ) : (
          <div className="grid flex-1 place-items-center p-6 text-center text-sm text-ink-muted">
            {selectedId && ready && selectedResult?.id === selectedId ? "La conversación no existe o no está a tu cargo." : selectedId ? "Cargando…" : "Elegí una conversación para empezar."}
          </div>
        )}
      </section>

      {/* Ficha del cliente */}
      {selected && (
        <>
          {panelOpen && <button type="button" aria-label="Cerrar ficha" className="fixed inset-0 z-30 bg-black/30 xl:hidden" onClick={() => setPanelOpen(false)} />}
          <aside
            aria-label="Cliente"
            className={`${panelOpen ? "fixed inset-y-0 right-0 z-40 flex w-[22rem] max-w-[90vw] shadow-xl" : "hidden"} flex-col border-l border-line bg-surface xl:static xl:z-auto xl:flex xl:w-80 xl:max-w-none xl:shadow-none 2xl:w-96`}
          >
            <ConversationPanel key={selected.id} props={props} conversation={selected} names={names} onClose={() => setPanelOpen(false)} />
          </aside>
        </>
      )}
    </div>
  );
}
