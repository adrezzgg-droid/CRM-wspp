# CRM de WhatsApp — instrucciones del proyecto

Producto SaaS multiempresa (se va a comercializar) que además se integra con el
sistema de gestión de la distribuidora del dueño (conector, no base compartida).
Idioma de la interfaz y de la documentación: español (Argentina, voseo).

## Decisiones ya tomadas (no reabrir sin avisar)

- **Stack:** Next.js (App Router) + TypeScript + Tailwind CSS, desplegado en Vercel.
- **Base y auth:** Firebase (Firestore + Firebase Auth + Storage). Servidor con Firebase Admin SDK.
- **Multiempresa:** todo vive bajo `organizations/{orgId}/...`. Ninguna colección de negocio en la raíz.
- **Escrituras:** el cliente es solo lectura (ver `firestore.rules`). Toda escritura pasa por la API del servidor, que valida con zod, aplica permisos y registra auditoría.
- **Lecturas desde el navegador (mínimo privilegio):** solo la bandeja (conversaciones, mensajes, el lead de a uno) y las notificaciones propias. Todo lo demás lo entrega el servidor; en las reglas se niega. Si una pantalla nueva necesita leer Firestore directo, se abre la regla puntual con su prueba.
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
- Los tests unitarios usan `node:test` sin dependencias. Los módulos que prueban (`src/lib/*` salvo `api-client` y `firebase`, `src/server/permissions/*`, `members/guards`, `org/defaults`) son puros y se importan entre sí con ruta relativa y extensión `.ts`; no usar `@/` ni `server-only` en ellos.
- Toda ruta nueva de la app va en `src/lib/navigation.ts` con su recurso de la matriz (un test falla si hay una carpeta en `src/app/(app)/` sin mapear) y la página llama a `requireAccess()`.
- Todo endpoint autenticado se arma con `apiRoute()` (`src/server/api/handler.ts`): CSRF por Origin, sesión, zod. La autorización fina (permiso + alcance propio/equipo/todo) vive en los servicios (`src/server/*/service.ts`), que usan las páginas y la API por igual.
- Documento fuera del alcance del usuario = 404 (no se revela que existe).
- Cada cambio se escribe junto con su `activities`/`auditLogs` en el mismo batch/transacción (`recordActivityIn`, `recordAuditIn`).
- Solo un usuario con rol `admin` crea/modifica admins y cambia los permisos por rol (evita escalada de privilegios).
- Clientes: `ownerId` es `null` (no ausente) si no tiene responsable; `whatsappId` es único por organización; `searchKeywords` se recalcula en cada escritura (`src/lib/search.ts`).
- Valores compartidos entre Server y Client Components no pueden vivir en un módulo `"use client"` (ver `components/ui/styles.ts`).
- Si el dev server da 404 en rutas nuevas, borrar `.next/dev` (caché de Turbopack). Tras horas de recargas en caliente se pone lento (>1 GB): reiniciarlo antes de correr `test:api`.
- **Mensajes entrantes: una sola puerta.** Todo entra por `ingestInbound` (`src/server/inbox/ingest-core.ts`), que es pura respecto de Next (recibe el Firestore) y la usan el simulador demo, el seed y, en la Fase 9, el webhook. El simulador arma el JSON exacto de Meta (`buildInboundPayload`) y lo pasa por `parseWebhook`. No escribir conversaciones/mensajes entrantes a mano.
- Conversación: una por número y cuenta (`${accountId}_${waId}`); cerrarla y que el cliente escriba la reabre. Mensaje entrante/saliente: id = `wamid` (idempotencia y estados). `contactName` y `customerStage` están copiados en la conversación y se sincronizan al editar el cliente.
- Salida: `senderFor(org)` (`src/server/inbox/sender.ts`). Demo nunca llama a Meta; real usa la Graph API con las credenciales de la empresa (`withGraph` en `src/server/whatsapp/service.ts`, que traduce los errores de Meta con `explainGraphError` y marca la cuenta en error si el token venció). Fuera de la ventana de 24 h solo plantillas aprobadas.
- Adjuntos: Storage es solo del servidor (`storage.rules` niega todo); el navegador los pide a `/api/conversations/{id}/messages/{msgId}/media`, que verifica alcance.
- Asignación: la decide `ingestInbound` en la misma transacción (responsable activo → dueño del cliente → reglas de `settings/assignment`: zona y turno rotativo por `member.lastAutoAssignedAt`). La lógica pura está en `src/lib/assignment.ts`. El lead nunca retrocede por eventos automáticos (`advanceLead`) y guarda la fecha de cada paso en `statusAt`.
- Demoras: `awaitingSince` = primer mensaje sin respuesta; `runSlaCheck` (`src/server/inbox/sla-core.ts`) avisa una vez por espera. Lo dispara `/api/cron/sla` (Bearer CRON_SECRET, cada 5 min en `vercel.json`) o el botón de Configuración → Asignación.
- Pipeline/pedidos (`src/server/commercial/`): los efectos sobre lead y cliente van por `readCommercialEffects` (lee todo antes de escribir, como exigen las transacciones). Pedido: número correlativo en `settings/counters` (transacción), transiciones por actor en `src/lib/orders.ts`, `counted` evita sumar dos veces a las estadísticas del cliente; al confirmar se encola en `outbox` solo para conectores habilitados en `settings/integrations`. El repartidor ve un pedido solo si `driverId` es él.
- Tareas: fecha/hora siempre en la zona horaria de la empresa (`zonedTimeToMs`/`dayBounds` en `src/lib/tasks.ts`); el cliente manda `dueDate` + `dueTime`, nunca un timestamp del navegador. Vencidas: `runOverdueTasks` (`src/server/tasks/overdue-core.ts`) en el mismo cron que las demoras. "Mi día" (`src/server/my-day.ts`) es siempre personal aunque el rol vea más. En Server Components no usar `Date.now()` (lint de pureza): calcularlo en el módulo de servidor.
- Automatizaciones: motor en `src/server/automations/engine-core.ts` (sin Next; recibe Firestore y la función de envío). Las de evento se disparan con `fireAutomations` DESPUÉS de guardar (ingestión de contacto nuevo, pedido confirmado) y nunca rompen la operación; las de tiempo y las agendadas corren en el cron. Idempotencia: `automationRuns/{regla}__{caso}` se crea con `create()`. Un mensaje automático no cuenta como respuesta (no toca `awaitingReply`).
- Plantillas: variables con nombre (`{{nombre}}`…) que se envían a Meta en formato posicional (`toMetaBody` en `src/lib/templates.ts`). Solo se envían las `aprobada`; editar el texto de una aprobada la vuelve a borrador. En el demo el estado se simula a mano. Escribirle al cliente (texto o plantilla) deja la conversación en atención, aunque estuviera cerrada.
- Dashboard: `getDashboard` (`src/server/dashboard/service.ts`) lee solo los documentos del período (con `.select()`) y cuenta en memoria con `src/lib/metrics.ts` (puro). El alcance propio/equipo/todo y los filtros de vendedor/equipo se aplican sobre el responsable de cada dato (`scopeAllows`). Períodos en la zona de la empresa; si el período está en curso se compara con el mismo tramo del anterior. Definiciones: venta = pedido confirmado (por `statusAt.confirmado`, sin cancelados); conversión = leads del período que llegaron a `pedido_generado`; tiempo de respuesta = primer mensaje del lead → `firstResponseAt`, descontando lo que queda fuera de `settings/general.businessHours` si está configurado. Lo que no depende del período (abiertas, para reactivar, perdidos, pipeline abierto) se marca "Ahora". Rango personalizado: máximo 366 días.
- Tipo de compra: al empezar a contar un pedido (`readCommercialEffects` con `purchase`) se guarda `Order.customerKind` (nuevo / recurrente / reactivado, `customerKindFor` en `src/lib/orders.ts`). Si el cliente estaba inactivo, perdido o para reactivar, comprar lo reactiva (vuelve a activo, se apaga `needsReactivation`, queda `cliente.reactivado` en el historial). Un pedido sin `leadId` se vincula al lead abierto más reciente del cliente.
- WhatsApp real (`src/server/whatsapp/`): webhook único `/api/webhooks/whatsapp` (público, sin `apiRoute`). `acceptWebhook` reparte el payload por empresa con `whatsappRoutes/{phone_<id>|waba_<id>}` (raíz) y valida la firma de CADA parte con el App Secret de su empresa (o `WHATSAPP_APP_SECRET` de la plataforma): una empresa no puede inyectar eventos de otra. Guarda el evento en `webhookEvents` (TTL 30 días por `expireAt`), responde 200 y procesa con `after()`; lo que falla lo reintenta el cron (`retryWebhookEvents`). Nunca se enruta al demo. Los núcleos (`webhook-core`, `accounts-core`, `graph`, `secret-box`, `signature`) no dependen de Next.
- Secretos (token, App Secret, Verify Token, secreto de conectores): AES-256-GCM con `SECRETS_ENCRYPTION_KEY` y el contexto `<orgId>:<campo>` como dato autenticado (`secret-box.ts`). Nunca vuelven al navegador ni a la auditoría (solo los últimos 4 del token). Conectar el número prueba los datos contra Meta y suscribe la app ANTES de guardar.
- Plantillas reales: "Enviar a Meta" (`submitTemplate`) y la aprobación llega por el webhook `message_template_status_update` (o "Sincronizar"). Enviada a Meta no se renombra; borrarla la borra también en Meta.
- Conectores (`src/server/connectors/`): `outbox` firmado HMAC (`X-CRM-Signature`, `X-CRM-Delivery`) con reintentos 1 min…24 h; lo procesa el cron. Entrada del estado del reparto en `/api/integrations/gestion/{orgId}` (firmada), aplicada con una sesión de sistema y `source: "gestion"` para no devolver el eco. URL del conector: https y sin direcciones internas (`checkConnectorUrl`). Contrato en `docs/CONECTOR-GESTION.md`. El demo no se conecta con nada.
- Diseño: el mismo de Impulse360 (panitas-app). Nunito, paleta índigo, lienzo con degradados, tarjetas `glass-card` (menús: `glass-card-menu`, sobre fondo oscuro: `glass-card-dark`), botón principal `btn-primario`, etiquetas en mayúsculas, login oscuro. Navegación sin menú lateral: barra superior + panel de categorías en `/` (`NAV_GROUPS`/`navGroupsFor` en `src/lib/navigation.ts`; toda sección nueva lleva `group` y `description`). Los estilos propios van en `@layer components`/`base` de `globals.css` para que las utilidades de Tailwind los puedan ajustar.
- Bandeja en tiempo real desde el navegador: las consultas salen de `inboxQuery()` (`src/lib/inbox-filters.ts`, devuelve `variants`: la lista es la unión). Vendedor: SIEMPRE `assigneeId == uid`. Supervisor: `assigneeId in <su equipo>` (en tandas de ≤30 combinaciones) + `assigneeId == null` por separado (las reglas no son filtros). Un test verifica que cada consulta tenga su índice en `firestore.indexes.json`.
- Reglas de la bandeja (`inboxSees` en `firestore.rules`): leen `inboxScope` / `scopeUids` / `active` de la ficha del usuario. Los mantiene `syncAccessScopes` (`src/server/members/scope-core.ts`) al cambiar usuarios, equipos o permisos (y el seed y el alta de usuarios); si a una ficha le falta, se completa al iniciar sesión (`npm run alcances:sincronizar` para todas). En las reglas, NUNCA `resource.data.get(campo, default)` para el responsable: en consultas sin filtro el motor usa el default y deja pasar todo (pasó: hay prueba de regresión; correr `npm run test:emulador`, el emulador de desarrollo no lo mostró).
- Páginas: CSP con nonce por pedido en `src/proxy.ts` (todas las páginas se renderizan por pedido: `connection()` en `app/layout.tsx`). Nada de scripts de terceros ni `dangerouslySetInnerHTML`. Archivos de usuarios/clientes: siempre con `attachmentHeaders()` (`src/lib/safe-content.ts`). Redirecciones con `safeNextPath()`.
- Auditoría (`/auditoria`, solo admin): `src/server/audit-query.ts`, nombres y categorías en `src/lib/audit-labels.ts` (un test exige que toda acción registrada tenga nombre). Exportar CSV también se registra.

## Comandos

- `npm run emulators` — Auth + Firestore + Storage locales (proyecto `demo-crm-whatsapp`, no requiere cuenta).
- `npm run seed:demo` — reinicia la organización demo: un usuario por rol, 12 clientes, conversaciones, catálogo, oportunidades, tareas, plantillas, automatizaciones de ejemplo y 60 días de historia para el dashboard (`scripts/lib/demo-history.ts`: los leads entran por la ingestión real con la fecha de entonces, vía el reloj opcional de `ingestInbound`; es determinística). Contraseña en `scripts/seed-demo.ts`, solo emulador.
- `npm run org:crear -- --nombre "..." --admin-email ... --admin-nombre "..."` — organización real.
- `npm run alcances:sincronizar` (`-- --remoto` en producción) — recalcula el alcance de la bandeja de todas las fichas.
- `npm run dev` · `npm run check` (typecheck + lint + test + build).
- `npm run test:emulador` (alias `test:rules`) — reglas + ingestión contra el emulador (con los emuladores de desarrollo APAGADOS: usa los mismos puertos).
- `npm run test:api` — API de punta a punta (con emuladores + seed + dev corriendo).
- `npm run test:whatsapp` — circuito real de WhatsApp y del conector contra la empresa "prueba-real" y un simulador de Meta (`tests/support/mock-meta.ts`, puerto 4010). Requiere emuladores + dev con `.env.local` que tenga las claves de desarrollo y `WHATSAPP_GRAPH_BASE_URL=http://127.0.0.1:4010`.
- Producción: `docs/PUESTA-EN-PRODUCCION.md`.

## Estado

Fase 1 cerrada: Next.js 16 + Tailwind 4, Firebase, login con sesión por cookie y custom claims, proxy,
guards, layout responsive con sidebar por permisos, banner DEMO, notificaciones en tiempo real.

Fase 2 cerrada: clientes (listado, alta/edición, baja lógica, ficha 360°, notas, contactos, historial),
usuarios, roles y permisos por empresa, equipos, empresa y configuración general.

Fase 3 cerrada:
parser del webhook de Meta (todos los tipos), ingestión idempotente (cliente+lead+conversación+avisos),
bandeja en tiempo real con 9 filtros, chat tipo WhatsApp, respuesta/nota interna/adjuntos, ventana de 24 h,
asignación manual con trazabilidad, estado/prioridad/etiquetas, ABM de etiquetas, desplegable de notificaciones,
simulador demo.

Fase 4 cerrada:
asignación automática (dueño del cliente, zona, turno rotativo, reasignación si el vendedor fue dado de baja),
asignación manual a persona y/o equipo, disponibilidad de cada vendedor, ABM de zonas con sus vendedores,
reglas configurables, alerta de demora (cron + manual) con indicador en la bandeja, recorrido del lead con
fechas (bandeja y ficha) y conversión prospecto → cliente nuevo al registrar la venta.

Fase 5 cerrada:
pipeline Kanban (arrastrar y soltar + "Mover a…", totales y ponderado, estancadas, perdida con motivo, efectos
sobre el lead y conversión del prospecto), catálogo de productos, pedidos (alta desde lista/ficha/bandeja,
numeración correlativa, borrador/confirmado/preparación/reparto/entregado/cancelado por rol, repartidor,
estadísticas del cliente, cola del conector), "Mis entregas" del repartidor.

Fase 6 cerrada:
tareas (6 tipos, vistas Hoy/Vencidas/Próximas/Completadas con contadores, completar con resultado que queda en
el historial, reprogramar, asignar dentro del equipo, crear desde lista/ficha/bandeja), avisos de tareas vencidas
(cron), "Mi día" por rol, historial de llamadas/visitas en la ficha, preferencias personales de notificación.

Fase 7 cerrada:
plantillas de WhatsApp (ABM, variables, vista previa, formato Meta, estado de aprobación simulable en demo, envío
desde la bandeja también fuera de las 24 h), automatizaciones SI → ENTONCES (contacto nuevo, cliente sin responder,
pedido confirmado, sin compras; condiciones por etapa y zona; demora; 6 acciones), registro de ejecuciones,
"Ejecutar ahora" y cron. Tipos de automatización estrictos (antes eran parámetros sueltos).

Fase 8 cerrada:
dashboard con filtros (hoy, ayer, 7 y 30 días, mes actual y anterior, rango personalizado; vendedor y equipo según
alcance), comparación con el período anterior, KPIs de ventas / leads / clientes / conversaciones con su definición,
gráficos por hora/día/mes con tooltip y tabla, embudo de leads, embudo comercial, rendimiento y detalle por vendedor,
clientes nuevos vs. recurrentes vs. reactivados, API `GET /api/dashboard`. Historia de 60 días en el demo.

Fase 9 cerrada:
WhatsApp Cloud API real: conexión del número desde Configuración (probada contra Meta, token cifrado), webhook con
firma por empresa, enrutamiento multiempresa, verificación, reintentos, envío de texto/archivos/plantillas, estados de
entrega, confirmación de lectura, descarga de adjuntos (al recibir o al abrir), plantillas enviadas a Meta y su
aprobación por webhook o sincronización, errores de Meta traducidos. Conector con el sistema de gestión (cola firmada
con reintentos, prueba, reintento manual, estado del reparto entrante sin eco). Documentación de producción.
Pruebas: 123 unitarias, 69 de emulador, 57 de API, 13 de WhatsApp real (simulador).

Fase 10 cerrada (última del plan):
auditoría de seguridad con 7 hallazgos corregidos (supervisor leía toda la empresa desde el navegador; regla con valor
por defecto que dejaba pasar consultas sin filtro; lecturas de más; adjuntos HTML/SVG ejecutables; redirección abierta;
conector a IP interna por DNS; Next.js con vulnerabilidad crítica → 16.4.6, zod → 4.6.7). Reglas de Firestore con mínimo
privilegio y alcance por equipo, CSP con nonce, COOP, auditoría visible y exportable, migración de alcances, test de
índices de la bandeja. Ver `docs/SEGURIDAD.md`.
Pruebas: 131 unitarias, 66 de emulador, 61 de API, 13 de WhatsApp real (simulador).

Cambios sobre lo heredado: `Order.driverId`; marca de lectura de notificaciones exige booleano; el supervisor
tiene `asignar` sobre clientes (equipo); notas, contactos y actividades ya no son legibles por el vendedor desde
el navegador (se las da el servidor filtradas); `Customer` suma `archived`, `archivedAt`, `searchKeywords` y
`ownerId: string | null`; `Order` suma `customerKind`; comprar reactiva al cliente marcado para reactivar; `Conversation` suma `contactName`, `customerStage`, `firstResponseAt`, `closedAt`, `lastMessageDirection` y `assigneeId: string | null`.

Especificación completa del producto: `docs/ESPECIFICACION.md`.
