/**
 * Motor de automatizaciones. Sin dependencias de Next: recibe el Firestore y
 * la función de envío por parámetro (la usan el servidor, el cron y las pruebas).
 *
 *  - Disparadores de evento (contacto nuevo, pedido confirmado): se ejecutan
 *    al momento, o se agendan si la regla tiene demora.
 *  - Disparadores de tiempo (cliente sin responder, sin compras): los revisa
 *    `runScheduledAutomations`, que también ejecuta lo agendado.
 *  - Idempotencia: cada ejecución crea `automationRuns/{regla}__{caso}`; si ya
 *    existe, no se repite.
 *  - Un mensaje automático NO cuenta como respuesta del equipo: no apaga la
 *    espera ni la alerta de demora.
 */
import { FieldValue, type Firestore, type WriteBatch } from "firebase-admin/firestore";
import type {
  Automation,
  AutomationAction,
  AutomationJob,
  AutomationRun,
  AutomationTrigger,
  Conversation,
  Customer,
  Member,
  Message,
  Notification,
  Order,
  Organization,
  Tag,
  Task,
  Team,
  WhatsappTemplate,
} from "../../types/model.ts";
import { CUSTOMER_STAGE_LABELS, TASK_TYPE_LABELS } from "../../types/model.ts";
import { ACTION_LABELS, conditionsMatch, runId, subjectKey } from "../../lib/automations.ts";
import { renderTemplate, toMetaBody } from "../../lib/templates.ts";
import { isWindowOpen, messagePreview } from "../../lib/whatsapp/webhook.ts";
import { OPEN_STATUSES } from "../../lib/inbox-filters.ts";

export interface OutboundPayload {
  text: string;
  template?: { name: string; language: string; params: string[] };
}
export type SendFn = (org: { isDemo: boolean }, to: string, payload: OutboundPayload) => Promise<{ wamid: string }>;

export interface EngineDeps {
  db: Firestore;
  send: SendFn;
  now?: number;
}

export interface AutomationContext {
  customerId: string;
  conversationId?: string;
  orderId?: string;
  /** Inicio del caso (última compra, último mensaje enviado) para la clave. */
  since?: number;
}

type ActionResult = AutomationRun["results"][number];

const isAlreadyExists = (e: unknown) => (e as { code?: number }).code === 6;

async function loadOrg(db: Firestore, orgId: string) {
  const org = (await db.collection("organizations").doc(orgId).get()).data() as Organization;
  return { id: orgId, name: org.name, timezone: org.timezone, currency: org.currency, isDemo: org.isDemo };
}
type OrgInfo = Awaited<ReturnType<typeof loadOrg>>;

// ──────────────────────────── Ejecución de una regla ────────────────────────

async function executeRule(deps: EngineDeps, org: OrgInfo, rule: Automation, ctx: AutomationContext, key: string): Promise<AutomationRun | null> {
  const { db } = deps;
  const now = deps.now ?? Date.now();
  const orgRef = db.collection("organizations").doc(org.id);
  const runRef = orgRef.collection("automationRuns").doc(runId(rule.id, key));
  const run: AutomationRun = {
    id: runRef.id,
    orgId: org.id,
    isDemo: org.isDemo,
    automationId: rule.id,
    automationName: rule.name,
    trigger: rule.trigger,
    subjectKey: key,
    customerId: ctx.customerId,
    conversationId: ctx.conversationId,
    orderId: ctx.orderId,
    status: "en_curso",
    results: [],
    at: now,
  };
  try {
    await runRef.create(run);
  } catch (e) {
    if (isAlreadyExists(e)) return null; // ya corrió para este caso
    throw e;
  }

  const customerRef = orgRef.collection("customers").doc(ctx.customerId);
  const customer = { ...((await customerRef.get()).data() as Customer), id: ctx.customerId };
  let conversation: Conversation | undefined;
  if (ctx.conversationId) {
    conversation = (await orgRef.collection("conversations").doc(ctx.conversationId).get()).data() as Conversation | undefined;
  } else {
    const snap = await orgRef.collection("conversations").where("customerId", "==", ctx.customerId).orderBy("lastMessageAt", "desc").limit(1).get();
    conversation = snap.docs[0]?.data() as Conversation | undefined;
  }
  const order = ctx.orderId ? ((await orgRef.collection("orders").doc(ctx.orderId).get()).data() as Order | undefined) : undefined;
  const members = (await orgRef.collection("members").where("active", "==", true).get()).docs.map((d) => ({ ...(d.data() as Member), id: d.id }));
  const owner = members.find((m) => m.id === (conversation?.assigneeId ?? customer.ownerId));

  const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: org.currency });
  const values: Record<string, string> = {
    nombre: customer.name,
    empresa: customer.company ?? customer.name,
    vendedor: owner?.displayName ?? org.name,
    pedido: order?.number ?? "",
    fecha: new Intl.DateTimeFormat("es-AR", { dateStyle: "short", timeZone: org.timezone }).format(now),
    importe: order ? money.format(order.total) : "",
  };

  async function syncStage(stage: Customer["stage"]) {
    const convs = await orgRef.collection("conversations").where("customerId", "==", customer.id).get();
    const batch = db.batch();
    batch.update(customerRef, { stage, updatedAt: now, updatedBy: "system" });
    for (const c of convs.docs) batch.update(c.ref, { customerStage: stage });
    await batch.commit();
    customer.stage = stage;
  }

  function notify(batch: WriteBatch, to: Member[], type: Notification["type"], title: string) {
    for (const m of to) {
      if (m.notificationPrefs?.[type] === false) continue;
      const ref = orgRef.collection("notifications").doc();
      batch.create(ref, { id: ref.id, orgId: org.id, isDemo: org.isDemo, userId: m.id, type, title, link: `/clientes/${customer.id}`, read: false, createdAt: now } satisfies Notification);
    }
  }

  async function doAction(a: AutomationAction): Promise<ActionResult> {
    switch (a.type) {
      case "enviar_mensaje": {
        if (!conversation) return { type: a.type, status: "omitida", detail: "El cliente no tiene conversación de WhatsApp" };
        let payload: OutboundPayload;
        let templateName: string | undefined;
        if (a.templateId) {
          const tpl = (await orgRef.collection("whatsappTemplates").doc(a.templateId).get()).data() as WhatsappTemplate | undefined;
          if (!tpl) return { type: a.type, status: "error", detail: "La plantilla no existe" };
          if (tpl.metaStatus !== "aprobada") return { type: a.type, status: "omitida", detail: `La plantilla "${tpl.name}" no está aprobada por Meta` };
          const { order: vars } = toMetaBody(tpl.body);
          payload = { text: renderTemplate(tpl.body, values), template: { name: tpl.name, language: tpl.language, params: vars.map((v) => values[v] ?? "") } };
          templateName = tpl.name;
        } else if (a.text) {
          if (!isWindowOpen(conversation.serviceWindowEndsAt, now)) {
            return { type: a.type, status: "omitida", detail: "Fuera de la ventana de 24 h: para escribir fuera de ella usá una plantilla aprobada" };
          }
          payload = { text: renderTemplate(a.text, values) };
        } else {
          return { type: a.type, status: "error", detail: "La acción no tiene texto ni plantilla" };
        }
        const { wamid } = await deps.send(org, conversation.waContactId, payload);
        const convRef = orgRef.collection("conversations").doc(conversation.id);
        const message: Message = {
          id: wamid,
          orgId: org.id,
          isDemo: org.isDemo,
          conversationId: conversation.id,
          direction: "out",
          type: templateName ? "template" : "text",
          text: payload.text,
          templateName,
          senderId: "system",
          status: "sent",
          timestamp: now,
          createdAt: now,
        };
        const batch = db.batch();
        batch.create(convRef.collection("messages").doc(wamid), message);
        // Solo la vista previa: la espera y la alerta siguen corriendo hasta que responda una persona.
        batch.update(convRef, { lastMessageAt: now, lastMessagePreview: messagePreview(message), lastMessageDirection: "out", updatedAt: now, updatedBy: "system" });
        await batch.commit();
        return { type: a.type, status: "ok", detail: templateName ? `Plantilla ${templateName}` : "Mensaje enviado" };
      }
      case "agregar_etiqueta": {
        const tag = (await orgRef.collection("tags").doc(a.tagId).get()).data() as Tag | undefined;
        if (!tag) return { type: a.type, status: "error", detail: "La etiqueta no existe" };
        const batch = db.batch();
        batch.update(customerRef, { tagIds: FieldValue.arrayUnion(a.tagId) });
        if (conversation) batch.update(orgRef.collection("conversations").doc(conversation.id), { tagIds: FieldValue.arrayUnion(a.tagId) });
        await batch.commit();
        return { type: a.type, status: "ok", detail: tag.name };
      }
      case "crear_tarea": {
        const assigneeId = conversation?.assigneeId ?? customer.ownerId;
        if (!assigneeId) return { type: a.type, status: "omitida", detail: "El cliente no tiene responsable" };
        const ref = orgRef.collection("tasks").doc();
        const task: Task = {
          id: ref.id,
          orgId: org.id,
          isDemo: org.isDemo,
          customerId: customer.id,
          customerName: customer.name,
          conversationId: conversation?.id,
          assigneeId,
          type: a.taskType,
          priority: "normal",
          status: "pendiente",
          dueAt: now + a.dueInHours * 3_600_000,
          description: a.description ? renderTemplate(a.description, values) : `Creada por la automatización "${rule.name}"`,
          createdAt: now,
          createdBy: "system",
          updatedAt: now,
          updatedBy: "system",
        };
        await ref.create(task);
        return { type: a.type, status: "ok", detail: `${TASK_TYPE_LABELS[a.taskType]} en ${a.dueInHours} h` };
      }
      case "cambiar_estado_cliente": {
        if (customer.stage === a.stage) return { type: a.type, status: "omitida", detail: `Ya estaba en ${CUSTOMER_STAGE_LABELS[a.stage]}` };
        await syncStage(a.stage);
        return { type: a.type, status: "ok", detail: CUSTOMER_STAGE_LABELS[a.stage] };
      }
      case "marcar_reactivar": {
        const demote = customer.stage === "cliente_activo" || customer.stage === "cliente_nuevo";
        if (customer.needsReactivation && !demote) return { type: a.type, status: "omitida", detail: "Ya estaba para reactivar" };
        await customerRef.update({ needsReactivation: true, updatedAt: now, updatedBy: "system" });
        if (demote) await syncStage("cliente_inactivo");
        const responsible = members.find((m) => m.id === customer.ownerId);
        if (responsible) {
          const batch = db.batch();
          notify(batch, [responsible], "cliente_reactivar", `${customer.name} está para reactivar`);
          await batch.commit();
        }
        return { type: a.type, status: "ok", detail: demote ? "Pasa a cliente inactivo" : undefined };
      }
      case "notificar": {
        let to: Member[] = [];
        if (a.to === "responsable") to = owner ? [owner] : [];
        else if (a.to === "administradores") to = members.filter((m) => m.role === "admin");
        else {
          const teams = (await orgRef.collection("teams").get()).docs.map((d) => d.data() as Team);
          const leaders = new Set(teams.filter((t) => owner && (t.memberIds.includes(owner.id) || t.leaderIds.includes(owner.id))).flatMap((t) => t.leaderIds));
          to = members.filter((m) => (leaders.size ? leaders.has(m.id) : m.role === "supervisor"));
        }
        if (!to.length) return { type: a.type, status: "omitida", detail: "No hay a quién avisar" };
        const batch = db.batch();
        notify(batch, to, "automatizacion", renderTemplate(a.message, values));
        await batch.commit();
        return { type: a.type, status: "ok", detail: `${to.length} aviso(s)` };
      }
    }
  }

  for (const action of rule.actions) {
    try {
      run.results.push(await doAction(action));
    } catch (e) {
      run.results.push({ type: action.type, status: "error", detail: e instanceof Error ? e.message : "Error" });
    }
  }
  const errors = run.results.filter((r) => r.status === "error").length;
  run.status = errors === 0 ? "ok" : errors === run.results.length ? "error" : "parcial";

  const done = run.results.filter((r) => r.status === "ok").map((r) => ACTION_LABELS[r.type].toLowerCase());
  const batch = db.batch();
  batch.update(runRef, { status: run.status, results: run.results });
  batch.update(orgRef.collection("automations").doc(rule.id), { lastRunAt: now, runsCount: FieldValue.increment(1) });
  const act = orgRef.collection("activities").doc();
  batch.create(act, {
    id: act.id,
    orgId: org.id,
    isDemo: org.isDemo,
    at: now,
    kind: "automatizacion.ejecutada",
    customerId: customer.id,
    conversationId: conversation?.id,
    orderId: ctx.orderId,
    actorId: "system",
    summary: `Automatización "${rule.name}"${done.length ? `: ${done.join(", ")}` : ": sin cambios"}`,
    data: { automationId: rule.id, results: run.results },
  });
  await batch.commit();
  return run;
}

// ─────────────────────────────── Eventos ────────────────────────────────────

async function rulesFor(db: Firestore, orgId: string, trigger: AutomationTrigger): Promise<Automation[]> {
  const snap = await db.collection("organizations").doc(orgId).collection("automations").where("trigger", "==", trigger).where("enabled", "==", true).get();
  return snap.docs.map((d) => ({ ...(d.data() as Automation), id: d.id }));
}

/** Contacto nuevo o pedido confirmado: ejecuta (o agenda) las reglas que aplican. */
export async function runEventAutomations(
  deps: EngineDeps,
  orgId: string,
  trigger: Extract<AutomationTrigger, "mensaje_nuevo_contacto" | "pedido_creado">,
  ctx: AutomationContext,
): Promise<{ executed: number; scheduled: number }> {
  const { db } = deps;
  const now = deps.now ?? Date.now();
  const rules = await rulesFor(db, orgId, trigger);
  if (!rules.length) return { executed: 0, scheduled: 0 };
  const org = await loadOrg(db, orgId);
  const customer = (await db.collection("organizations").doc(orgId).collection("customers").doc(ctx.customerId).get()).data() as Customer | undefined;
  if (!customer || customer.archived) return { executed: 0, scheduled: 0 };

  let executed = 0;
  let scheduled = 0;
  for (const rule of rules) {
    if (!conditionsMatch(rule.conditions ?? {}, customer)) continue;
    const key = subjectKey(trigger, ctx);
    if (rule.delayMinutes > 0) {
      const ref = db.collection("organizations").doc(orgId).collection("automationJobs").doc(runId(rule.id, key));
      const job: AutomationJob = { id: ref.id, orgId, isDemo: org.isDemo, automationId: rule.id, runAt: now + rule.delayMinutes * 60_000, subjectKey: key, context: ctx, status: "pendiente", createdAt: now };
      try {
        await ref.create(job);
        scheduled += 1;
      } catch (e) {
        if (!isAlreadyExists(e)) throw e;
      }
    } else if (await executeRule(deps, org, rule, ctx, key)) {
      executed += 1;
    }
  }
  return { executed, scheduled };
}

// ─────────────────────────── Revisión periódica ─────────────────────────────

const LOOKBACK_MS = 7 * 86_400_000;

export async function runScheduledAutomations(deps: EngineDeps, orgId: string): Promise<{ jobs: number; noReply: number; noPurchase: number }> {
  const { db } = deps;
  const now = deps.now ?? Date.now();
  const orgRef = db.collection("organizations").doc(orgId);
  const out = { jobs: 0, noReply: 0, noPurchase: 0 };
  const org = await loadOrg(db, orgId);

  // 1. Reglas con demora que ya vencieron.
  const jobs = await orgRef.collection("automationJobs").where("status", "==", "pendiente").where("runAt", "<=", now).limit(200).get();
  for (const j of jobs.docs) {
    const job = j.data() as AutomationJob;
    const ruleSnap = await orgRef.collection("automations").doc(job.automationId).get();
    const rule = ruleSnap.exists ? ({ ...(ruleSnap.data() as Automation), id: ruleSnap.id }) : null;
    if (rule?.enabled && (await executeRule(deps, org, rule, job.context, job.subjectKey))) out.jobs += 1;
    await j.ref.update({ status: "hecha" });
  }

  // 2. Clientes que no responden: le escribimos y no contestó en X horas.
  for (const rule of await rulesFor(db, orgId, "sin_respuesta_cliente")) {
    const threshold = now - (rule.triggerParams.hours ?? 24) * 3_600_000;
    const snap = await orgRef
      .collection("conversations")
      .where("awaitingReply", "==", false)
      .where("status", "in", OPEN_STATUSES)
      .where("lastMessageAt", "<=", threshold)
      .where("lastMessageAt", ">=", threshold - LOOKBACK_MS)
      .limit(300)
      .get();
    for (const d of snap.docs) {
      const c = d.data() as Conversation;
      if (c.lastMessageDirection !== "out") continue;
      const customer = (await orgRef.collection("customers").doc(c.customerId).get()).data() as Customer | undefined;
      if (!customer || customer.archived || !conditionsMatch(rule.conditions ?? {}, customer)) continue;
      const ctx = { customerId: c.customerId, conversationId: c.id, since: c.lastMessageAt };
      if (await executeRule(deps, org, rule, ctx, subjectKey("sin_respuesta_cliente", ctx))) out.noReply += 1;
    }
  }

  // 3. Clientes que dejaron de comprar.
  for (const rule of await rulesFor(db, orgId, "sin_compra_dias")) {
    const threshold = now - (rule.triggerParams.days ?? 30) * 86_400_000;
    const snap = await orgRef.collection("customers").where("archived", "==", false).where("lastPurchaseAt", "<=", threshold).limit(300).get();
    for (const d of snap.docs) {
      const customer = d.data() as Customer;
      if (!conditionsMatch(rule.conditions ?? {}, customer)) continue;
      const ctx = { customerId: d.id, since: customer.lastPurchaseAt };
      if (await executeRule(deps, org, rule, ctx, subjectKey("sin_compra_dias", ctx))) out.noPurchase += 1;
    }
  }
  return out;
}

export async function runScheduledAutomationsAll(deps: EngineDeps) {
  const orgs = await deps.db.collection("organizations").where("status", "==", "active").get();
  const out = [];
  for (const o of orgs.docs) out.push({ orgId: o.id, ...(await runScheduledAutomations(deps, o.id)) });
  return out;
}
