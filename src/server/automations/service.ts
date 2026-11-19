import "server-only";
import type { z } from "zod";
import type { Automation, AutomationRun, WhatsappTemplate } from "@/types/model";
import { orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { recordAuditIn } from "@/server/audit";
import { can, type Action } from "@/server/permissions/matrix";
import type { Session } from "@/server/auth/session";
import { getTags, getZones } from "@/server/org/data";
import { extractVariables, SAMPLE_VALUES, toMetaBody, type TemplateVariable } from "@/lib/templates";
import { withGraph } from "@/server/whatsapp/service";
import { createTemplate as createMetaTemplate, deleteTemplate as deleteMetaTemplate, editTemplate as editMetaTemplate, listTemplates as listMetaTemplates, mapTemplateStatus } from "@/server/whatsapp/graph";
import type { automationInput, templateInput } from "@/lib/schemas";
import { runScheduledForOrg } from "./run";

const col = (orgId: string, c: Parameters<typeof orgPath>[1]) => adminDb().collection(orgPath(orgId, c));

function requirePerm(session: Session, resource: "plantillas" | "automatizaciones", action: Action) {
  if (!can(session.role, resource, action, session.overrides)) throw new ApiError(403, "No tenés permiso para esta acción");
}

function audit(session: Session, action: string, target: { collection: string; id: string }, before?: unknown, after?: unknown) {
  return { orgId: session.orgId, isDemo: session.org.isDemo, actorId: session.uid, action, target, before, after };
}

// ───────────────────────────── Plantillas ───────────────────────────────────

export async function listTemplates(session: Session): Promise<WhatsappTemplate[]> {
  requirePerm(session, "plantillas", "ver");
  const snap = await col(session.orgId, "whatsappTemplates").orderBy("name").get();
  return snap.docs.map((d) => ({ ...(d.data() as WhatsappTemplate), id: d.id }));
}

async function assertUniqueTemplate(session: Session, name: string, language: string, exceptId?: string) {
  const clash = (await listTemplates(session)).find((t) => t.name === name && t.language === language && t.id !== exceptId);
  if (clash) throw new ApiError(409, "Ya existe una plantilla con ese nombre e idioma", [{ path: ["name"], message: "Nombre repetido" }]);
}

export async function createTemplate(session: Session, input: z.output<typeof templateInput>): Promise<WhatsappTemplate> {
  requirePerm(session, "plantillas", "crear");
  await assertUniqueTemplate(session, input.name, input.language);
  const ref = col(session.orgId, "whatsappTemplates").doc();
  const now = Date.now();
  const tpl: WhatsappTemplate = {
    ...input,
    id: ref.id,
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    variables: extractVariables(input.body),
    metaStatus: "borrador",
    createdAt: now,
    createdBy: session.uid,
    updatedAt: now,
    updatedBy: session.uid,
  };
  const batch = adminDb().batch();
  batch.create(ref, tpl);
  recordAuditIn(batch, audit(session, "template.created", { collection: "whatsappTemplates", id: ref.id }, undefined, input), now);
  await batch.commit();
  return tpl;
}

/** Editar una plantilla aprobada la vuelve a borrador: Meta tiene que aprobar el texto nuevo. */
export async function updateTemplate(session: Session, id: string, input: z.output<typeof templateInput>) {
  requirePerm(session, "plantillas", "editar");
  const current = (await listTemplates(session)).find((t) => t.id === id);
  if (!current) throw new ApiError(404, "Plantilla no encontrada");
  await assertUniqueTemplate(session, input.name, input.language, id);
  // Meta identifica la plantilla por nombre e idioma: una vez enviada no se pueden cambiar.
  if (current.metaTemplateId && (current.name !== input.name || current.language !== input.language)) {
    throw new ApiError(409, "Esta plantilla ya se envió a Meta: no se puede cambiar el nombre ni el idioma. Creá una nueva.", [{ path: ["name"], message: "No se puede cambiar" }]);
  }
  const changedText = current.body !== input.body || current.name !== input.name || current.language !== input.language || current.category !== input.category;
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(col(session.orgId, "whatsappTemplates").doc(id), {
    ...input,
    variables: extractVariables(input.body),
    ...(changedText && current.metaStatus !== "borrador" ? { metaStatus: "borrador" } : {}),
    updatedAt: now,
    updatedBy: session.uid,
  });
  recordAuditIn(batch, audit(session, "template.updated", { collection: "whatsappTemplates", id }, { name: current.name, body: current.body, metaStatus: current.metaStatus }, input), now);
  await batch.commit();
}

/**
 * Estado de aprobación. En organizaciones reales lo informa Meta (Fase 9); en
 * el demo se puede marcar a mano para probar el envío de plantillas.
 */
export async function setTemplateStatus(session: Session, id: string, metaStatus: WhatsappTemplate["metaStatus"]) {
  requirePerm(session, "plantillas", "editar");
  if (!session.org.isDemo) throw new ApiError(409, "La aprobación de plantillas la informa Meta. Usá «Enviar a Meta» y «Sincronizar con Meta».");
  const current = (await listTemplates(session)).find((t) => t.id === id);
  if (!current) throw new ApiError(404, "Plantilla no encontrada");
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(col(session.orgId, "whatsappTemplates").doc(id), { metaStatus, updatedAt: now, updatedBy: session.uid });
  recordAuditIn(batch, audit(session, "template.status", { collection: "whatsappTemplates", id }, { metaStatus: current.metaStatus }, { metaStatus }), now);
  await batch.commit();
}

export async function deleteTemplate(session: Session, id: string) {
  requirePerm(session, "plantillas", "eliminar");
  const current = (await listTemplates(session)).find((t) => t.id === id);
  if (!current) throw new ApiError(404, "Plantilla no encontrada");
  const users = (await col(session.orgId, "automations").get()).docs.filter((d) =>
    (d.data() as Automation).actions.some((a) => a.type === "enviar_mensaje" && a.templateId === id),
  );
  if (users.length) throw new ApiError(409, `La usa la automatización "${(users[0].data() as Automation).name}". Quitala de ahí primero.`);
  // Si estaba en Meta, también se borra allá (si Meta ya no la tiene, se sigue igual).
  if (!session.org.isDemo && current.metaTemplateId) {
    await withGraph(session.orgId, (cfg, c) => deleteMetaTemplate(cfg, c.account.wabaId, current)).catch((error) => {
      if (!(error instanceof ApiError && error.status === 502 && /does not exist|no existe/i.test(error.message))) throw error;
    });
  }
  const batch = adminDb().batch();
  batch.delete(col(session.orgId, "whatsappTemplates").doc(id));
  recordAuditIn(batch, audit(session, "template.deleted", { collection: "whatsappTemplates", id }, { name: current.name, body: current.body }));
  await batch.commit();
}

/**
 * Enviar la plantilla a revisión de Meta (o reenviar el texto editado de una
 * ya creada). Las variables con nombre viajan en formato posicional, con
 * valores de ejemplo como pide Meta.
 */
export async function submitTemplate(session: Session, id: string): Promise<WhatsappTemplate> {
  requirePerm(session, "plantillas", "editar");
  if (session.org.isDemo) throw new ApiError(409, "En el demo la aprobación se simula a mano.");
  const current = (await listTemplates(session)).find((t) => t.id === id);
  if (!current) throw new ApiError(404, "Plantilla no encontrada");
  if (current.category === "authentication") throw new ApiError(422, "Las plantillas de autenticación (códigos) se crean desde el administrador de WhatsApp de Meta.");
  if (current.metaStatus === "pendiente") throw new ApiError(409, "Ya está en revisión de Meta");
  const { text, order } = toMetaBody(current.body);
  const examples = order.map((v) => SAMPLE_VALUES[v as TemplateVariable] ?? v);
  const result = await withGraph(session.orgId, async (cfg, c) => {
    if (current.metaTemplateId) {
      await editMetaTemplate(cfg, current.metaTemplateId, { category: current.category, metaText: text, examples });
      return { id: current.metaTemplateId, status: "PENDING" };
    }
    return createMetaTemplate(cfg, c.account.wabaId, { name: current.name, language: current.language, category: current.category, metaText: text, examples });
  });
  const now = Date.now();
  const metaStatus = mapTemplateStatus(result.status ?? "PENDING");
  const batch = adminDb().batch();
  batch.update(col(session.orgId, "whatsappTemplates").doc(id), { metaTemplateId: result.id, metaStatus, rejectedReason: null, submittedAt: now, updatedAt: now, updatedBy: session.uid });
  recordAuditIn(batch, audit(session, "template.submitted", { collection: "whatsappTemplates", id }, { metaStatus: current.metaStatus }, { metaStatus, metaTemplateId: result.id }), now);
  await batch.commit();
  return { ...current, metaTemplateId: result.id, metaStatus, submittedAt: now };
}

/** Traer de Meta el estado de todas las plantillas (por si se perdió algún aviso). */
export async function syncTemplates(session: Session): Promise<{ updated: number; onlyInMeta: string[] }> {
  requirePerm(session, "plantillas", "editar");
  if (session.org.isDemo) throw new ApiError(409, "El demo no está conectado a Meta.");
  const [local, remote] = await Promise.all([listTemplates(session), withGraph(session.orgId, (cfg, c) => listMetaTemplates(cfg, c.account.wabaId))]);
  const now = Date.now();
  const batch = adminDb().batch();
  let updated = 0;
  const matched = new Set<string>();
  for (const t of local) {
    const r = remote.find((x) => (t.metaTemplateId && x.id === t.metaTemplateId) || (x.name === t.name && x.language === t.language));
    if (!r) continue;
    matched.add(r.id);
    const metaStatus = mapTemplateStatus(r.status);
    // Un borrador editado localmente no se pisa: espera a que lo reenvíen.
    if (t.metaStatus === "borrador" && t.metaTemplateId) continue;
    if (t.metaStatus === metaStatus && t.metaTemplateId === r.id) continue;
    updated += 1;
    batch.update(col(session.orgId, "whatsappTemplates").doc(t.id), {
      metaTemplateId: r.id,
      metaStatus,
      rejectedReason: metaStatus === "rechazada" ? (r.rejected_reason && r.rejected_reason !== "NONE" ? r.rejected_reason : r.status) : null,
      updatedAt: now,
      updatedBy: session.uid,
    });
  }
  recordAuditIn(batch, audit(session, "template.synced", { collection: "whatsappTemplates", id: "*" }, undefined, { updated }), now);
  await batch.commit();
  return { updated, onlyInMeta: remote.filter((r) => !matched.has(r.id)).map((r) => `${r.name} (${r.language})`) };
}

// ─────────────────────────── Automatizaciones ───────────────────────────────

export async function listAutomations(session: Session): Promise<Automation[]> {
  requirePerm(session, "automatizaciones", "ver");
  const snap = await col(session.orgId, "automations").orderBy("name").get();
  return snap.docs.map((d) => ({ ...(d.data() as Automation), id: d.id }));
}

export async function recentRuns(session: Session, limit = 30): Promise<AutomationRun[]> {
  requirePerm(session, "automatizaciones", "ver");
  const snap = await col(session.orgId, "automationRuns").orderBy("at", "desc").limit(limit).get();
  return snap.docs.map((d) => ({ ...(d.data() as AutomationRun), id: d.id }));
}

/** Las referencias (etiquetas, plantillas, zonas) tienen que existir. */
async function assertRefs(session: Session, input: z.output<typeof automationInput>) {
  const [tags, zones, templates] = await Promise.all([getTags(session.orgId), getZones(session.orgId), listTemplates(session)]);
  for (const a of input.actions) {
    if (a.type === "agregar_etiqueta" && !tags.some((t) => t.id === a.tagId)) throw new ApiError(422, "Una acción usa una etiqueta que no existe");
    if (a.type === "enviar_mensaje" && a.templateId && !templates.some((t) => t.id === a.templateId)) throw new ApiError(422, "Una acción usa una plantilla que no existe");
  }
  if (input.conditions.zoneIds?.some((z) => !zones.some((x) => x.id === z))) throw new ApiError(422, "Una condición usa una zona que no existe");
}

function clean(input: z.output<typeof automationInput>) {
  return {
    name: input.name,
    enabled: input.enabled,
    trigger: input.trigger,
    triggerParams:
      input.trigger === "sin_respuesta_cliente" ? { hours: input.triggerParams.hours } : input.trigger === "sin_compra_dias" ? { days: input.triggerParams.days } : {},
    conditions: {
      ...(input.conditions.stages?.length ? { stages: input.conditions.stages } : {}),
      ...(input.conditions.zoneIds?.length ? { zoneIds: input.conditions.zoneIds } : {}),
    },
    delayMinutes: input.delayMinutes,
    actions: input.actions,
  };
}

export async function createAutomation(session: Session, input: z.output<typeof automationInput>): Promise<Automation> {
  requirePerm(session, "automatizaciones", "crear");
  await assertRefs(session, input);
  const ref = col(session.orgId, "automations").doc();
  const now = Date.now();
  const automation: Automation = { ...clean(input), id: ref.id, orgId: session.orgId, isDemo: session.org.isDemo, runsCount: 0, createdAt: now, createdBy: session.uid, updatedAt: now, updatedBy: session.uid };
  const batch = adminDb().batch();
  batch.create(ref, automation);
  recordAuditIn(batch, audit(session, "automation.created", { collection: "automations", id: ref.id }, undefined, clean(input)), now);
  await batch.commit();
  return automation;
}

export async function updateAutomation(session: Session, id: string, input: z.output<typeof automationInput>) {
  requirePerm(session, "automatizaciones", "editar");
  const ref = col(session.orgId, "automations").doc(id);
  const current = (await ref.get()).data() as Automation | undefined;
  if (!current) throw new ApiError(404, "Automatización no encontrada");
  await assertRefs(session, input);
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(ref, { ...clean(input), updatedAt: now, updatedBy: session.uid });
  recordAuditIn(batch, audit(session, "automation.updated", { collection: "automations", id }, { name: current.name, enabled: current.enabled, trigger: current.trigger, actions: current.actions }, clean(input)), now);
  await batch.commit();
}

export async function toggleAutomation(session: Session, id: string, enabled: boolean) {
  requirePerm(session, "automatizaciones", "editar");
  const ref = col(session.orgId, "automations").doc(id);
  const current = (await ref.get()).data() as Automation | undefined;
  if (!current) throw new ApiError(404, "Automatización no encontrada");
  if (current.enabled === enabled) return;
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(ref, { enabled, updatedAt: now, updatedBy: session.uid });
  recordAuditIn(batch, audit(session, enabled ? "automation.enabled" : "automation.disabled", { collection: "automations", id }, { enabled: current.enabled }, { enabled }), now);
  await batch.commit();
}

/** El historial de ejecuciones se conserva aunque se borre la regla. */
export async function deleteAutomation(session: Session, id: string) {
  requirePerm(session, "automatizaciones", "eliminar");
  const ref = col(session.orgId, "automations").doc(id);
  const current = (await ref.get()).data() as Automation | undefined;
  if (!current) throw new ApiError(404, "Automatización no encontrada");
  const batch = adminDb().batch();
  batch.delete(ref);
  recordAuditIn(batch, audit(session, "automation.deleted", { collection: "automations", id }, { name: current.name, trigger: current.trigger, actions: current.actions }));
  await batch.commit();
}

/** "Ejecutar ahora": lo mismo que hace la tarea programada, para esta empresa. */
export async function runAutomationsNow(session: Session) {
  requirePerm(session, "automatizaciones", "editar");
  return runScheduledForOrg(session.orgId);
}
