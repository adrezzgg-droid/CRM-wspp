import "server-only";
import { cache } from "react";
import type { z } from "zod";
import type { Product } from "@/types/model";
import { adminDb } from "@/server/firebase/admin";
import { ApiError } from "@/server/api/handler";
import { recordAuditIn } from "@/server/audit";
import { can, type Action } from "@/server/permissions/matrix";
import type { Session } from "@/server/auth/session";
import { diffFields } from "@/lib/diff";
import { normalizeText } from "@/lib/search";
import type { productInput } from "@/lib/schemas";
import { col } from "./common";

type ProductInput = z.output<typeof productInput>;

function requireProducts(session: Session, action: Action) {
  if (!can(session.role, "productos", action, session.overrides)) throw new ApiError(403, "No tenés permiso para esta acción sobre productos");
}

/** Catálogo completo (una empresa distribuidora maneja cientos, no miles). */
export const getProducts = cache(async (orgId: string): Promise<Product[]> => {
  const snap = await col(orgId, "products").orderBy("name").get();
  return snap.docs.map((d) => ({ ...(d.data() as Product), id: d.id }));
});

export async function listProducts(session: Session, f: { q?: string; inactivos?: string } = {}): Promise<Product[]> {
  requireProducts(session, "ver");
  const terms = f.q ? normalizeText(f.q).split(" ").filter(Boolean) : [];
  return (await getProducts(session.orgId))
    .filter((p) => f.inactivos === "1" || p.active)
    .filter((p) => {
      const text = normalizeText(`${p.name} ${p.sku ?? ""}`);
      return terms.every((t) => text.includes(t));
    });
}

async function assertUniqueSku(session: Session, sku: string | undefined, exceptId?: string) {
  if (!sku) return;
  const clash = (await getProducts(session.orgId)).find((p) => p.sku?.toLowerCase() === sku.toLowerCase() && p.id !== exceptId);
  if (clash) throw new ApiError(409, `El código ya lo usa "${clash.name}"`, [{ path: ["sku"], message: "Código repetido" }]);
}

export async function createProduct(session: Session, input: ProductInput): Promise<Product> {
  requireProducts(session, "crear");
  await assertUniqueSku(session, input.sku);
  const ref = col(session.orgId, "products").doc();
  const now = Date.now();
  const product: Product = { ...input, id: ref.id, orgId: session.orgId, isDemo: session.org.isDemo, createdAt: now, createdBy: session.uid, updatedAt: now, updatedBy: session.uid };
  const batch = adminDb().batch();
  batch.create(ref, product);
  recordAuditIn(batch, { orgId: session.orgId, isDemo: session.org.isDemo, actorId: session.uid, action: "product.created", target: { collection: "products", id: ref.id }, after: input }, now);
  await batch.commit();
  return product;
}

/** No se borran productos: se desactivan (los pedidos viejos los referencian). */
export async function updateProduct(session: Session, id: string, input: ProductInput) {
  requireProducts(session, "editar");
  const current = (await getProducts(session.orgId)).find((p) => p.id === id);
  if (!current) throw new ApiError(404, "Producto no encontrado");
  await assertUniqueSku(session, input.sku, id);
  const changes = diffFields(current, input, ["name", "sku", "unit", "price", "active"]);
  if (!Object.keys(changes).length) return;
  const now = Date.now();
  const batch = adminDb().batch();
  batch.update(col(session.orgId, "products").doc(id), { ...input, sku: input.sku ?? null, updatedAt: now, updatedBy: session.uid });
  recordAuditIn(batch, { orgId: session.orgId, isDemo: session.org.isDemo, actorId: session.uid, action: "product.updated", target: { collection: "products", id }, before: Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.before])), after: Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.after])) }, now);
  await batch.commit();
}
