import "server-only";
import type { z } from "zod";
import type { Tag } from "@/types/model";
import { orgPath } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { recordAuditIn } from "@/server/audit";
import { can, type Action } from "@/server/permissions/matrix";
import type { Session } from "@/server/auth/session";
import type { tagInput } from "@/lib/schemas";
import { getTags } from "./data";

type TagInput = z.output<typeof tagInput>;
const col = (orgId: string) => adminDb().collection(orgPath(orgId, "tags"));

function requireTags(session: Session, action: Action) {
  if (!can(session.role, "etiquetas", action, session.overrides)) throw new ApiError(403, "No tenés permiso para administrar etiquetas");
}

async function assertUniqueName(session: Session, name: string, exceptId?: string) {
  const clash = (await getTags(session.orgId)).find((t) => t.name === name && t.id !== exceptId);
  if (clash) throw new ApiError(409, "Ya existe una etiqueta con ese nombre", [{ path: ["name"], message: "Nombre repetido" }]);
}

export async function createTag(session: Session, input: TagInput): Promise<Tag> {
  requireTags(session, "crear");
  await assertUniqueName(session, input.name);
  const ref = col(session.orgId).doc();
  const now = Date.now();
  const tag: Tag = {
    ...input,
    id: ref.id,
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    createdAt: now,
    createdBy: session.uid,
    updatedAt: now,
    updatedBy: session.uid,
  };
  const batch = adminDb().batch();
  batch.create(ref, tag);
  recordAuditIn(batch, { orgId: session.orgId, isDemo: session.org.isDemo, actorId: session.uid, action: "tag.created", target: { collection: "tags", id: ref.id }, after: input }, now);
  await batch.commit();
  return tag;
}

export async function updateTag(session: Session, id: string, input: TagInput) {
  requireTags(session, "editar");
  const current = (await getTags(session.orgId)).find((t) => t.id === id);
  if (!current) throw new ApiError(404, "Etiqueta no encontrada");
  await assertUniqueName(session, input.name, id);
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(col(session.orgId).doc(id), { ...input, updatedAt: now, updatedBy: session.uid });
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: "tag.updated",
    target: { collection: "tags", id },
    before: { name: current.name, color: current.color },
    after: input,
  }, now);
  await batch.commit();
}

/**
 * Borra la etiqueta. Clientes y conversaciones conservan el id en su historial;
 * la interfaz ignora ids de etiquetas inexistentes.
 */
export async function deleteTag(session: Session, id: string) {
  requireTags(session, "eliminar");
  const current = (await getTags(session.orgId)).find((t) => t.id === id);
  if (!current) throw new ApiError(404, "Etiqueta no encontrada");
  const batch = adminDb().batch();
  batch.delete(col(session.orgId).doc(id));
  recordAuditIn(batch, {
    orgId: session.orgId,
    isDemo: session.org.isDemo,
    actorId: session.uid,
    action: "tag.deleted",
    target: { collection: "tags", id },
    before: { name: current.name, color: current.color },
  });
  await batch.commit();
}
