/**
 * Reglas de negocio sobre altas, cambios y bajas de usuarios. Código puro.
 * Devuelven el motivo del rechazo o null si se permite.
 */
import type { Role } from "../permissions/matrix.ts";

interface Actor {
  uid: string;
  role: Role;
}

interface Target {
  id: string;
  role: Role;
  active: boolean;
}

export function checkCreate(actor: Actor, role: Role): string | null {
  if (role === "admin" && actor.role !== "admin") return "Solo un administrador puede crear administradores.";
  return null;
}

export function checkRoleChange(
  actor: Actor,
  target: Target,
  newRole: Role,
  activeAdmins: number,
): string | null {
  if (newRole === target.role) return null;
  if (target.id === actor.uid) return "No podés cambiar tu propio rol.";
  if ((target.role === "admin" || newRole === "admin") && actor.role !== "admin") {
    return "Solo un administrador puede dar o quitar el rol de administrador.";
  }
  if (target.role === "admin" && target.active && activeAdmins <= 1) {
    return "Es el único administrador activo: asigná otro antes de cambiarle el rol.";
  }
  return null;
}

export function checkEdit(actor: Actor, target: Target): string | null {
  if (target.role === "admin" && actor.role !== "admin" && target.id !== actor.uid) {
    return "Solo un administrador puede modificar a otro administrador.";
  }
  return null;
}

export function checkStatusChange(actor: Actor, target: Target, active: boolean, activeAdmins: number): string | null {
  if (target.active === active) return null;
  if (target.id === actor.uid) return "No podés darte de baja a vos mismo.";
  if (target.role === "admin" && actor.role !== "admin") return "Solo un administrador puede dar de baja a otro administrador.";
  if (!active && target.role === "admin" && activeAdmins <= 1) return "Es el único administrador activo.";
  return null;
}
