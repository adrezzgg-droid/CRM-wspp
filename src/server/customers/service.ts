import "server-only";
import { FieldValue, type Query, type Transaction } from "firebase-admin/firestore";
import type {
  Activity,
  Contact,
  Conversation,
  Customer,
  Note,
  Opportunity,
  Order,
  Task,
} from "@/types/model";
import { CUSTOMER_STAGE_LABELS, orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { recordActivityIn, type ActivityEntry } from "@/server/audit";
import { can, type Action } from "@/server/permissions/matrix";
import { scopeAllows } from "@/server/permissions/scope";
import type { Session } from "@/server/auth/session";
import { getGeneralSettings, getMembers, getTags, getZones, OWNER_ROLES, scopeContext } from "@/server/org/data";
import { customerKeywords, matchesAll, queryTerms } from "@/lib/search";
import { toWhatsappId } from "@/lib/phone";
import { diffFields } from "@/lib/diff";
import type { CustomerListQuery, contactInput, customerInput, customerUpdate } from "@/lib/schemas";
import type { z } from "zod";

type CreateInput = z.output<typeof customerInput>;
type UpdateInput = z.output<typeof customerUpdate>;
type ContactInput = z.output<typeof contactInput>;

export const CUSTOMERS_PAGE_SIZE = 50;

const EDITABLE_KEYS = [
  "name",
  "company",
  "phone",
  "whatsappId",
  "email",
  "address",
  "neighborhood",
  "zoneId",
  "locality",
  "customerType",
  "industry",
  "ownerId",
  "stage",
  "needsReactivation",
  "tagIds",
] as const satisfies readonly (keyof Customer)[];

const col = (orgId: string, c: Parameters<typeof orgPath>[1]) => adminDb().collection(orgPath(orgId, c));

function fieldError(field: string, message: string, status = 422): ApiError {
  return new ApiError(status, message, [{ path: [field], message }]);
}

function requirePermission(session: Session, action: Action): void {
  if (!can(session.role, "clientes", action, session.overrides)) {
    throw new ApiError(403, "No tenés permiso para esta acción sobre clientes");
  }
}

function activity(session: Session, customerId: string, kind: string, summary: string, data?: Record<string, unknown>): ActivityEntry {
  return { orgId: session.orgId, isDemo: session.org.isDemo, customerId, kind, summary, actorId: session.uid, data };
}

// ───────────────────────────── Validaciones ────────────────────────────────

async function assertValidOwner(session: Session, ownerId: string | null): Promise<string | null> {
  if (ownerId === null) return null;
  const member = (await getMembers(session.orgId)).find((m) => m.id === ownerId);
  if (!member || !member.active || !OWNER_ROLES.has(member.role)) {
    throw fieldError("ownerId", "El responsable no es un usuario activo que pueda atender clientes");
  }
  const ctx = await scopeContext(session, "clientes");
  if (!scopeAllows(ctx, ownerId)) throw fieldError("ownerId", "Solo podés asignar clientes dentro de tu equipo", 403);
  return member.displayName;
}

async function assertValidRefs(session: Session, input: { tagIds?: string[]; zoneId?: string }): Promise<void> {
  if (input.tagIds?.length) {
    const known = new Set((await getTags(session.orgId)).map((t) => t.id));
    const unknown = input.tagIds.filter((t) => !known.has(t));
    if (unknown.length) throw fieldError("tagIds", "Hay etiquetas que no existen");
  }
  if (input.zoneId) {
    const zones = await getZones(session.orgId);
    if (!zones.some((z) => z.id === input.zoneId)) throw fieldError("zoneId", "La zona no existe");
  }
}

/** wa_id a partir del campo WhatsApp (obligatorio que sea válido) o, si no vino, del teléfono. */
async function resolveWhatsappId(session: Session, whatsapp?: string, phone?: string): Promise<string | undefined> {
  const { defaultCountryCode } = await getGeneralSettings(session.orgId);
  if (whatsapp) {
    const waId = toWhatsappId(whatsapp, defaultCountryCode);
    if (!waId) throw fieldError("whatsapp", "No se reconoce el número de WhatsApp. Probá con formato +54 9 351 555 1234");
    return waId;
  }
  return phone ? (toWhatsappId(phone, defaultCountryCode) ?? undefined) : undefined;
}

/** Un mismo WhatsApp no puede pertenecer a dos clientes (la bandeja los une por ese número). */
async function assertUniqueWhatsapp(tx: Transaction, session: Session, waId: string, exceptId?: string) {
  const snap = await tx.get(col(session.orgId, "customers").where("whatsappId", "==", waId).limit(2));
  const other = snap.docs.find((d) => d.id !== exceptId);
  if (!other) return;
  const existing = other.data() as Customer;
  const ctx = await scopeContext(session, "clientes");
  const visible = can(session.role, "clientes", "ver", session.overrides) && scopeAllows(ctx, existing.ownerId);
  throw new ApiError(409, visible ? `Ya existe un cliente con ese WhatsApp: ${existing.name}` : "Ya existe un cliente con ese WhatsApp, asignado a otro vendedor", [
    { path: ["whatsapp"], message: "WhatsApp repetido", existingId: visible ? other.id : undefined },
  ]);
}

// ──────────────────────────────── Lectura ──────────────────────────────────

/** Cliente visible para el usuario o 404 (no revela si existe fuera de su alcance). */
export async function getAccessibleCustomer(session: Session, id: string): Promise<Customer> {
  requirePermission(session, "ver");
  const snap = await col(session.orgId, "customers").doc(id).get();
  if (!snap.exists) throw new ApiError(404, "Cliente no encontrado");
  const customer = { ...(snap.data() as Customer), id: snap.id };
  if (!scopeAllows(await scopeContext(session, "clientes"), customer.ownerId)) {
    throw new ApiError(404, "Cliente no encontrado");
  }
  return customer;
}

export interface CustomerPage {
  items: Customer[];
  nextCursor: string | null;
}

/**
 * Listado con alcance por rol. Filtros de igualdad en la consulta; si hay
 * búsqueda, el término más largo va a `array-contains` y el resto (y la
 * etiqueta) se filtra en memoria, leyendo de a tandas hasta llenar la página.
 */
export async function listCustomers(session: Session, f: CustomerListQuery): Promise<CustomerPage> {
  requirePermission(session, "ver");
  const ctx = await scopeContext(session, "clientes");
  let q: Query = col(session.orgId, "customers").where("archived", "==", f.archivados === "1");
  let memoryFilter: (c: Customer) => boolean = () => true;
  const addFilter = (fn: (c: Customer) => boolean) => {
    const prev = memoryFilter;
    memoryFilter = (c) => prev(c) && fn(c);
  };

  if (f.owner === "none") {
    if (ctx.scope === "propio") return { items: [], nextCursor: null };
    q = q.where("ownerId", "==", null);
  } else if (f.owner) {
    if (!scopeAllows(ctx, f.owner)) return { items: [], nextCursor: null };
    q = q.where("ownerId", "==", f.owner);
  } else if (ctx.scope === "propio") {
    q = q.where("ownerId", "==", session.uid);
  } else if (ctx.scope === "equipo") {
    // `in` admite hasta 30 valores; equipos más grandes se filtran en memoria.
    if (ctx.teamUids.length <= 30) q = q.where("ownerId", "in", [...ctx.teamUids]);
    else addFilter((c) => scopeAllows(ctx, c.ownerId));
  }

  if (f.stage) q = q.where("stage", "==", f.stage);
  if (f.zone) q = q.where("zoneId", "==", f.zone);
  if (f.reactivar === "1") q = q.where("needsReactivation", "==", true);

  const terms = f.q ? queryTerms(f.q) : [];
  if (terms.length) {
    q = q.where("searchKeywords", "array-contains", terms[0]);
    if (terms.length > 1) addFilter((c) => matchesAll(c.searchKeywords ?? [], terms));
    if (f.tag) addFilter((c) => c.tagIds.includes(f.tag!));
  } else if (f.tag) {
    q = q.where("tagIds", "array-contains", f.tag);
  }

  q = q.orderBy("updatedAt", "desc");
  if (f.cursor) {
    const cursorSnap = await col(session.orgId, "customers").doc(f.cursor).get();
    if (cursorSnap.exists) q = q.startAfter(cursorSnap);
  }

  const items: Customer[] = [];
  let lastId: string | null = null;
  let more = false;
  for (let round = 0; round < 5 && items.length < CUSTOMERS_PAGE_SIZE; round++) {
    const snap = await q.limit(CUSTOMERS_PAGE_SIZE).get();
    let i = 0;
    while (i < snap.docs.length && items.length < CUSTOMERS_PAGE_SIZE) {
      const d = snap.docs[i++];
      lastId = d.id;
      const c = { ...(d.data() as Customer), id: d.id };
      if (memoryFilter(c)) items.push(c);
    }
    // Quedaron documentos sin mirar en esta tanda, o la tanda vino llena: hay más.
    more = i < snap.docs.length || snap.size === CUSTOMERS_PAGE_SIZE;
    if (!more) break;
    q = q.startAfter(snap.docs.at(-1)!);
  }
  return { items, nextCursor: more && lastId ? lastId : null };
}

export interface Customer360 {
  customer: Customer;
  contacts: Contact[];
  notes: Note[];
  activities: Activity[];
  conversations: Conversation[];
  orders: Order[];
  tasks: Task[];
  opportunities: Opportunity[];
}

export async function getCustomer360(session: Session, id: string): Promise<Customer360> {
  const customer = await getAccessibleCustomer(session, id);
  const by = (c: Parameters<typeof orgPath>[1]) => col(session.orgId, c).where("customerId", "==", id);
  const rows = async <T,>(q: Query) => (await q.get()).docs.map((d) => ({ ...(d.data() as T), id: d.id }));
  const [contacts, notes, activities, conversations, orders, tasks, opportunities] = await Promise.all([
    rows<Contact>(by("contacts").orderBy("name").limit(50)),
    rows<Note>(by("notes").orderBy("createdAt", "desc").limit(50)),
    rows<Activity>(by("activities").orderBy("at", "desc").limit(100)),
    rows<Conversation>(by("conversations").orderBy("lastMessageAt", "desc").limit(20)),
    rows<Order>(by("orders").orderBy("createdAt", "desc").limit(20)),
    rows<Task>(by("tasks").where("status", "==", "pendiente").orderBy("dueAt").limit(20)),
    rows<Opportunity>(by("opportunities").orderBy("updatedAt", "desc").limit(20)),
  ]);
  return { customer, contacts, notes, activities, conversations, orders, tasks, opportunities };
}

// ──────────────────────────────── Escritura ────────────────────────────────

export async function createCustomer(session: Session, input: CreateInput): Promise<Customer> {
  requirePermission(session, "crear");

  // Responsable: quien puede asignar elige (o deja sin asignar); el resto, para sí.
  let ownerId: string | null;
  if (can(session.role, "clientes", "asignar", session.overrides)) {
    ownerId = input.ownerId === undefined ? (OWNER_ROLES.has(session.role) ? session.uid : null) : input.ownerId;
  } else {
    if (input.ownerId && input.ownerId !== session.uid) {
      throw fieldError("ownerId", "No podés asignar clientes a otro usuario", 403);
    }
    ownerId = session.uid;
  }
  const ownerName = await assertValidOwner(session, ownerId);
  await assertValidRefs(session, input);
  const whatsappId = await resolveWhatsappId(session, input.whatsapp, input.phone);

  const ref = col(session.orgId, "customers").doc();
  const now = Date.now();
  const customer: Customer = {
    id: ref.id,
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    name: input.name,
    company: input.company,
    phone: input.phone,
    whatsappId,
    email: input.email,
    address: input.address,
    neighborhood: input.neighborhood,
    zoneId: input.zoneId,
    locality: input.locality,
    customerType: input.customerType,
    industry: input.industry,
    ownerId,
    stage: input.stage,
    needsReactivation: input.needsReactivation,
    tagIds: [...new Set(input.tagIds)],
    stats: { totalPurchased: 0, ordersCount: 0, avgTicket: 0 },
    archived: false,
    searchKeywords: [],
    createdAt: now,
    createdBy: session.uid,
    updatedAt: now,
    updatedBy: session.uid,
  };
  customer.searchKeywords = customerKeywords(customer);

  await adminDb().runTransaction(async (tx) => {
    if (whatsappId) await assertUniqueWhatsapp(tx, session, whatsappId);
    tx.create(ref, customer);
    recordActivityIn(tx, activity(session, ref.id, "cliente.creado", `Cliente creado como ${CUSTOMER_STAGE_LABELS[customer.stage].toLowerCase()}`), now);
    if (ownerId && ownerId !== session.uid) {
      recordActivityIn(tx, activity(session, ref.id, "cliente.asignado", `Asignado a ${ownerName}`, { ownerId }), now);
    }
    if (input.note) {
      const noteRef = col(session.orgId, "notes").doc();
      tx.create(noteRef, noteDoc(session, noteRef.id, ref.id, input.note, now));
      recordActivityIn(tx, activity(session, ref.id, "nota.agregada", excerpt(input.note), { noteId: noteRef.id }), now);
    }
  });
  return customer;
}

export async function updateCustomer(session: Session, id: string, input: UpdateInput): Promise<Customer> {
  requirePermission(session, "editar");
  const current = await getAccessibleCustomer(session, id);
  if (current.archived) throw new ApiError(409, "El cliente está dado de baja. Restauralo para editarlo.");

  const patch: Partial<Customer> = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === "whatsapp") continue;
    (patch as Record<string, unknown>)[k] = v;
  }

  let ownerName: string | null = null;
  if ("ownerId" in input && input.ownerId !== undefined && input.ownerId !== current.ownerId) {
    requirePermission(session, "asignar");
    ownerName = await assertValidOwner(session, input.ownerId);
  } else {
    delete patch.ownerId;
  }
  await assertValidRefs(session, input);
  if ("whatsapp" in input) {
    // WhatsApp explícito; si se vació, se toma del teléfono.
    const phone = "phone" in input ? input.phone : current.phone;
    patch.whatsappId = await resolveWhatsappId(session, input.whatsapp, phone);
  } else if ("phone" in input && input.phone && !current.whatsappId) {
    // Cambiar el teléfono no pisa un WhatsApp existente; solo lo completa si faltaba.
    patch.whatsappId = await resolveWhatsappId(session, undefined, input.phone);
  }
  if (patch.tagIds) patch.tagIds = [...new Set(patch.tagIds)];

  const changes = diffFields(current, patch, EDITABLE_KEYS);
  if (Object.keys(changes).length === 0) return current;

  const next: Customer = { ...current, ...patch };
  const now = Date.now();
  const write: Record<string, unknown> = {
    searchKeywords: customerKeywords(next),
    updatedAt: now,
    updatedBy: session.uid,
  };
  for (const key of Object.keys(changes)) {
    const value = (patch as Record<string, unknown>)[key];
    write[key] = value === undefined ? FieldValue.delete() : value;
  }

  await adminDb().runTransaction(async (tx) => {
    const fresh = await tx.get(col(session.orgId, "customers").doc(id));
    if ((fresh.data() as Customer | undefined)?.updatedAt !== current.updatedAt) {
      throw new ApiError(409, "Otra persona modificó este cliente recién. Recargá la página y volvé a intentar.");
    }
    if (changes.whatsappId && next.whatsappId) await assertUniqueWhatsapp(tx, session, next.whatsappId, id);
    // Nombre y etapa están copiados en sus conversaciones (lista y filtros de la bandeja).
    const conversations = changes.name || changes.stage ? await tx.get(col(session.orgId, "conversations").where("customerId", "==", id)) : null;
    tx.update(fresh.ref, write);
    for (const c of conversations?.docs ?? []) {
      tx.update(c.ref, { contactName: next.name, customerStage: next.stage });
    }

    const { ownerId: ownerChange, stage: stageChange, ...rest } = changes;
    if (ownerChange) {
      recordActivityIn(tx, activity(session, id, "cliente.reasignado", ownerName ? `Reasignado a ${ownerName}` : "Quedó sin responsable", { ownerId: ownerChange }), now);
    }
    if (stageChange) {
      recordActivityIn(
        tx,
        activity(session, id, "cliente.etapa", `Etapa: ${CUSTOMER_STAGE_LABELS[next.stage]}`, { stage: stageChange }),
        now,
      );
    }
    if (Object.keys(rest).length) {
      recordActivityIn(tx, activity(session, id, "cliente.actualizado", "Datos actualizados", { changes: rest }), now);
    }
  });
  return { ...next, updatedAt: now, updatedBy: session.uid };
}

export async function setCustomerArchived(session: Session, id: string, archived: boolean): Promise<void> {
  requirePermission(session, "eliminar");
  const current = await getAccessibleCustomer(session, id);
  if (current.archived === archived) return;
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(col(session.orgId, "customers").doc(id), {
    archived,
    archivedAt: archived ? now : FieldValue.delete(),
    updatedAt: now,
    updatedBy: session.uid,
  });
  recordActivityIn(batch, activity(session, id, archived ? "cliente.baja" : "cliente.restaurado", archived ? "Cliente dado de baja" : "Cliente restaurado"), now);
  await batch.commit();
}

// ──────────────────────────────── Notas ────────────────────────────────────

function excerpt(text: string): string {
  return text.length > 140 ? `${text.slice(0, 137)}…` : text;
}

function noteDoc(session: Session, id: string, customerId: string, text: string, now: number): Note {
  return {
    id,
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    customerId,
    text,
    createdAt: now,
    createdBy: session.uid,
    updatedAt: now,
    updatedBy: session.uid,
  };
}

/** Las notas son de solo inserción: no se editan ni se borran (historial). */
export async function addCustomerNote(session: Session, customerId: string, text: string): Promise<Note> {
  requirePermission(session, "crear");
  await getAccessibleCustomer(session, customerId);
  const now = Date.now();
  const ref = col(session.orgId, "notes").doc();
  const note = noteDoc(session, ref.id, customerId, text, now);
  const batch = adminDb().batch();
  batch.create(ref, note);
  recordActivityIn(batch, activity(session, customerId, "nota.agregada", excerpt(text), { noteId: ref.id }), now);
  await batch.commit();
  return note;
}

// ─────────────────────────────── Contactos ─────────────────────────────────

export async function addContact(session: Session, customerId: string, input: ContactInput): Promise<Contact> {
  requirePermission(session, "editar");
  await getAccessibleCustomer(session, customerId);
  const now = Date.now();
  const ref = col(session.orgId, "contacts").doc();
  const contact: Contact = {
    ...input,
    id: ref.id,
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    customerId,
    createdAt: now,
    createdBy: session.uid,
    updatedAt: now,
    updatedBy: session.uid,
  };
  const batch = adminDb().batch();
  batch.create(ref, contact);
  recordActivityIn(batch, activity(session, customerId, "contacto.agregado", `Contacto agregado: ${input.name}`, { contactId: ref.id }), now);
  await batch.commit();
  return contact;
}

async function loadContact(session: Session, customerId: string, contactId: string) {
  requirePermission(session, "editar");
  await getAccessibleCustomer(session, customerId);
  const ref = col(session.orgId, "contacts").doc(contactId);
  const snap = await ref.get();
  const contact = snap.data() as Contact | undefined;
  if (!contact || contact.customerId !== customerId) throw new ApiError(404, "Contacto no encontrado");
  return { ref, contact };
}

export async function updateContact(session: Session, customerId: string, contactId: string, input: ContactInput) {
  const { ref, contact } = await loadContact(session, customerId, contactId);
  const changes = diffFields(contact, input, ["name", "role", "phone", "email"]);
  if (!Object.keys(changes).length) return;
  const now = Date.now();
  const write: Record<string, unknown> = { updatedAt: now, updatedBy: session.uid };
  for (const key of ["name", "role", "phone", "email"] as const) {
    write[key] = input[key] === undefined ? FieldValue.delete() : input[key];
  }
  const batch = adminDb().batch();
  batch.update(ref, write);
  recordActivityIn(batch, activity(session, customerId, "contacto.actualizado", `Contacto actualizado: ${input.name}`, { contactId, changes }), now);
  await batch.commit();
}

export async function deleteContact(session: Session, customerId: string, contactId: string) {
  const { ref, contact } = await loadContact(session, customerId, contactId);
  const batch = adminDb().batch();
  batch.delete(ref);
  // El contacto se borra, pero sus datos quedan en el historial del cliente.
  recordActivityIn(batch, activity(session, customerId, "contacto.eliminado", `Contacto eliminado: ${contact.name}`, {
    contactId,
    before: { name: contact.name, role: contact.role ?? null, phone: contact.phone ?? null, email: contact.email ?? null },
  }));
  await batch.commit();
}
