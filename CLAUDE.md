# CRM de WhatsApp — instrucciones del proyecto

Producto SaaS multiempresa (se va a comercializar) que además se integra con el
sistema de gestión de la distribuidora del dueño (conector, no base compartida).
Idioma de la interfaz y de la documentación: español (Argentina, voseo).

## Decisiones ya tomadas (no reabrir sin avisar)

- **Stack:** Next.js (App Router) + TypeScript + Tailwind CSS, desplegado en Vercel.
- **Base y auth:** Firebase (Firestore + Firebase Auth + Storage). Servidor con Firebase Admin SDK.
- **Multiempresa:** todo vive bajo `organizations/{orgId}/...`. Ninguna colección de negocio en la raíz.
- **Escrituras:** el cliente es solo lectura (ver `firestore.rules`). Toda escritura pasa por la API del servidor, que valida con zod, aplica permisos y registra auditoría.
- **Roles:** admin, supervisor, vendedor, repartidor, solo_lectura. Matriz en `src/server/permissions/matrix.ts` (debe coincidir con `firestore.rules`). Los roles viajan como custom claims (`orgId`, `role`).
- **Secretos:** el Access Token de WhatsApp nunca llega al frontend. Se guarda cifrado (AES-256-GCM, clave en variable de entorno) en `organizations/{orgId}/secrets/whatsapp`.
- **WhatsApp:** Meta Cloud API. El webhook valida firma `X-Hub-Signature-256`, guarda el evento crudo, responde 200 rápido y procesa de forma idempotente (el `wamid` es el id del mensaje). Respetar la ventana de 24 h: fuera de ella, solo plantillas aprobadas.
- **Modo demo:** organización propia con `isDemo: true`. Nunca escribe en una org real ni envía mensajes a Meta. El demo entra por la misma tubería que los mensajes reales (endpoint simulado).
- **Conectores:** interfaz común en `src/server/connectors/` + cola `outbox` con reintentos. Primer conector: sistema de gestión de la distribuidora (pedido creado → gestión; estado de reparto → CRM). Futuros: Google Sheets, Mercado Pago, ERP, email, Instagram, Messenger, API externa, Power BI.
- **Flujo central:** Lead → Vendedor → Cliente → Pedido → Venta → Reparto. Cada eslabón guarda la referencia al anterior (ver `Order` y `Activity` en `src/types/model.ts`).

## Reglas de trabajo

- Trabajar por fases (ver HANDOFF.md). No avanzar a la siguiente sin cerrar la actual.
- Al cerrar cada fase: `npm run build`, typecheck, lint, tests, revisar rutas y permisos, revisar responsive, explicar qué quedó funcionando y qué falta.
- No eliminar ni reemplazar código funcional sin explicarlo antes.
- Nada de maquetas: cada pantalla lee y escribe datos reales (los datos demo solo sirven para mostrar el inicio).
- Registrar en `activities` (negocio) y `auditLogs` (seguridad/configuración) solo por inserción; nunca perder historial.
- Fechas: epoch ms (`number`) en Firestore, no `Timestamp` (ver comentario en `src/types/model.ts`).
- Los tests unitarios usan `node:test` sin dependencias. Los módulos que prueban (`matrix`, `navigation`, `origin`, `org/defaults`) son puros y se importan entre sí con ruta relativa y extensión `.ts`; no usar `@/` ni `server-only` en ellos.
- Toda ruta nueva de la app va en `src/lib/navigation.ts` con su recurso de la matriz (un test falla si hay una carpeta en `src/app/(app)/` sin mapear) y la página llama a `requireAccess()`.
- Todo endpoint autenticado se arma con `apiRoute()` (`src/server/api/handler.ts`): CSRF por Origin, sesión, permiso, zod.

## Comandos

- `npm run emulators` — Auth + Firestore locales (proyecto `demo-crm-whatsapp`, no requiere cuenta).
- `npm run seed:demo` — organización demo con un usuario por rol (contraseña en `scripts/seed-demo.ts`, solo emulador).
- `npm run org:crear -- --nombre "..." --admin-email ... --admin-nombre "..."` — organización real.
- `npm run dev` · `npm run check` (typecheck + lint + test + build) · `npm run test:rules` (reglas en emulador).

## Estado

Fase 1 cerrada (pendiente de confirmación del dueño para pasar a la Fase 2):
Next.js 16 + Tailwind 4, Firebase Admin/cliente, login con sesión por cookie httpOnly y custom claims,
validación por petición contra el miembro en Firestore (baja o cambio de rol = sin acceso), proxy de
rutas, guards de página y de API, layout responsive con sidebar filtrada por permisos, banner DEMO,
campana de notificaciones en tiempo real, páginas base de cada módulo, `firestore.indexes.json`,
31 pruebas de reglas con emulador, 24 tests unitarios.

Cambios sobre lo heredado: `Order.driverId` (el repartidor no podía ver sus pedidos porque la regla miraba
`sellerId`) y la marca de lectura de notificaciones exige booleano.

Especificación completa del producto: `docs/ESPECIFICACION.md`.
