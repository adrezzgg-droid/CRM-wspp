import type { Scope } from "@/server/permissions/matrix";
import type { CustomerFormOptions } from "../clientes/customer-form";

/** Datos que el servidor le pasa a la bandeja (ya recortados por permisos). */
export interface InboxProps {
  uid: string;
  orgId: string;
  timezone: string;
  isDemo: boolean;
  scope: Scope | null;
  teamUids: string[];
  members: { id: string; name: string; role: string; active: boolean }[];
  /** Usuarios a los que este usuario puede asignar conversaciones. */
  assignable: { id: string; name: string }[];
  tags: { id: string; name: string; color: string }[];
  canEdit: boolean;
  canAssign: boolean;
  /** Para editar el cliente desde el panel (null = sin permiso). */
  customerOptions: CustomerFormOptions | null;
  canEditCustomer: boolean;
}
