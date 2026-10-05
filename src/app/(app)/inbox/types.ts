import type { Scope } from "@/server/permissions/matrix";
import type { CustomerFormOptions } from "../clientes/customer-form";
import type { OpportunityFormOptions } from "@/components/commercial/opportunity-form";
import type { ProductOption } from "@/components/commercial/order-form";
import type { TaskFormOptions } from "@/components/tasks/task-form";

/** Datos que el servidor le pasa a la bandeja (ya recortados por permisos). */
export interface InboxProps {
  uid: string;
  orgId: string;
  timezone: string;
  isDemo: boolean;
  scope: Scope | null;
  teamUids: string[];
  /** Equipos que lidera (supervisor): ve lo sin asignar de esos equipos y de ninguno. */
  myTeamIds: string[];
  /** Equipos a los que puede asignar. */
  teams: { id: string; name: string }[];
  sla: { enabled: boolean; minutes: number };
  members: { id: string; name: string; role: string; active: boolean }[];
  /** Usuarios a los que este usuario puede asignar conversaciones. */
  assignable: { id: string; name: string }[];
  tags: { id: string; name: string; color: string }[];
  canEdit: boolean;
  canAssign: boolean;
  /** Para editar el cliente desde el panel (null = sin permiso). */
  customerOptions: CustomerFormOptions | null;
  canEditCustomer: boolean;
  /** Crear oportunidad desde el chat (null = sin permiso). */
  opportunityOptions: OpportunityFormOptions | null;
  /** Productos para crear un pedido desde el chat (null = sin permiso). */
  orderProducts: ProductOption[] | null;
  currency: string;
  /** Crear tareas desde el chat (null = sin permiso). */
  taskOptions: TaskFormOptions | null;
  /** Plantillas aprobadas por Meta que se pueden enviar desde el chat. */
  templates: { id: string; name: string; body: string }[];
}
