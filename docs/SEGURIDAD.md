# Seguridad del CRM

Resumen de cómo está protegido el CRM, qué se probó y qué queda como riesgo
aceptado. Se actualiza cuando cambia algo de esto.

## Capas

| Capa | Control | Dónde |
|---|---|---|
| Identidad | Firebase Auth. La sesión es una cookie `httpOnly` (`__session`), creada solo con un token de menos de 5 minutos. Cada pedido verifica la cookie contra revocación y la ficha del usuario (activo y con el mismo rol). Dar de baja a un usuario o cambiarle el rol revoca sus sesiones. | `src/server/auth/session.ts`, `src/app/api/auth/session` |
| Empresas | Todo vive en `organizations/{orgId}`. El `orgId` sale siempre de la sesión, nunca de lo que manda el navegador. | servicios en `src/server/*` |
| Permisos | Matriz por rol con alcance propio, equipo o todo, y permisos personalizables por empresa. Se aplica en el servidor. Un documento fuera del alcance responde 404, para no revelar que existe. | `src/server/permissions`, servicios |
| API | `apiRoute()` exige sesión, comprueba el Origin en las escrituras (CSRF) y valida con zod. Los errores no filtran detalles internos. | `src/server/api/handler.ts` |
| Navegador → base | Reglas de Firestore con mínimo privilegio. El navegador solo lee la bandeja (conversaciones, mensajes, el lead de a uno) y sus notificaciones, con el alcance de su ficha (`inboxScope`, `scopeUids`, `active`). Todo lo demás se niega. No escribe nada, salvo marcar como leída una notificación propia. | `firestore.rules`, `src/server/members/scope-core.ts` |
| Archivos | Storage solo es accesible desde el servidor. Los adjuntos se sirven tras verificar el alcance. Solo imagen, audio, video y PDF se abren en el navegador; el resto se descarga como `application/octet-stream`, siempre con `CSP: sandbox` y `nosniff`. | `storage.rules`, `src/lib/safe-content.ts` |
| Páginas | CSP con nonce por pedido (`strict-dynamic`); scripts solo propios; conexiones solo al sitio y a Firebase; `frame-ancestors 'none'`. También HSTS, X-Frame-Options, COOP, nosniff y Referrer-Policy. | `src/proxy.ts`, `next.config.ts` |
| Secretos | Token de WhatsApp, App Secret, Verify Token y secreto de conectores, cifrados con AES-256-GCM. La clave está en `SECRETS_ENCRYPTION_KEY` y el contexto `orgId:campo` va como dato autenticado. Nunca vuelven al navegador ni a la auditoría. | `src/server/whatsapp/secret-box.ts` |
| Webhooks | Firma `X-Hub-Signature-256` validada **por empresa**, para que nadie inyecte eventos en otra. Eventos crudos con TTL de 30 días. El demo nunca recibe tráfico real. | `src/server/whatsapp/webhook-core.ts` |
| Conectores | HMAC en las dos direcciones e id de entrega para no procesar dos veces. La URL tiene que ser https y no puede ser interna, ni por texto ni por resolución DNS (cada envío). Sin seguir redirecciones. | `src/server/connectors` |
| Tarea programada | `Authorization: Bearer CRON_SECRET`, comparado en tiempo constante. | `src/app/api/cron/sla` |
| Redirecciones | El destino después del login tiene que ser una ruta propia. Se rechazan `//x`, `/\x` y caracteres de control. | `src/lib/safe-content.ts` |
| Historial | `activities` (negocio) y `auditLogs` (seguridad y configuración) son solo de inserción. La auditoría se puede ver y exportar (solo admin) y la exportación también queda registrada. | `src/server/audit*.ts`, `/auditoria` |

## Pruebas que lo cubren

- `npm test`: cifrado, firmas y validación de URLs y DNS del conector.
  También: redirecciones, encabezados de adjuntos, alcance de la bandeja, que
  cada consulta del navegador tenga su índice, y que toda acción auditada
  tenga nombre.
- `npm run test:emulador`: reglas de Firestore por rol (aislamiento, mínimo
  privilegio, supervisor por equipo, usuario dado de baja) y la regresión de
  la consulta sin filtro. También el webhook (firma por empresa, inyección
  cruzada) y la cola del conector.
- `npm run test:api`: permisos y alcance de punta a punta, CSRF, CSP con
  nonce, redirección y auditoría.
- `npm run test:whatsapp`: circuito real contra un simulador de Meta. El token
  nunca vuelve al navegador y en la base está cifrado.

## Hallazgos de la Fase 10 (corregidos)

1. **Supervisor veía toda la empresa desde el navegador.** Las reglas lo
   dejaban leer todo y el filtro por equipo se hacía en el navegador. Ahora
   las reglas aplican el alcance por equipo, y la bandeja consulta solo su
   equipo y lo sin asignar.
2. **Una regla con valor por defecto dejaba pasar una consulta sin filtro.**
   `resource.data.get('assigneeId', null)` hacía que el motor tomara la
   consulta entera como "sin asignar". El emulador de desarrollo no lo
   mostraba; se vio con `emulators:exec`. Ahora se lee el campo directo y los
   leads no se pueden listar. Tiene prueba de regresión.
3. **Lectura de más.** Clientes, pedidos, notas, historial, auditoría y
   configuración eran legibles desde el navegador aunque la app no lo usara.
   Ahora se niegan.
4. **Archivos de clientes ejecutables.** Un HTML o SVG mandado por WhatsApp
   se abría en el dominio del CRM. Ahora se descarga, aislado.
5. **Redirección abierta** con `/\otro.com` después del login.
6. **Conector a una IP interna** por DNS (un nombre público que resuelve a
   una red privada).
7. **Dependencias.** Next.js tenía una vulnerabilidad crítica (ejecución
   remota en el optimizador de imágenes) y zod una alta: se actualizaron a
   16.4.6 y 4.6.7. El `@grpc/grpc-js` de la librería de Firebase del
   navegador se fijó a ≥ 1.14.5.

## Riesgos aceptados (revisar si cambia el contexto)

- **`npm audit` informa 7 dependencias moderadas** dentro de `firebase-admin`
  (`google-gax`, `gaxios`, `rimraf`, `glob`, `uuid`). Son utilidades internas
  que el CRM no usa con datos de usuarios. Se resuelven cuando Google
  actualice esas librerías.
- **Cerrar sesión borra la cookie de este navegador, pero no revoca las otras
  sesiones del usuario** (si no, se cerrarían también en el celular). Una
  cookie robada sigue sirviendo hasta que vence (`SESSION_DAYS`, por defecto
  5 días). Dar de baja al usuario o cambiarle el rol sí revoca todo.
- **Sin límite de pedidos por IP en la app.**
  - El login lo protege Firebase Auth.
  - Los webhooks y el conector exigen firma, así que no se pueden forzar.
  - Contra abuso por volumen, activar el firewall de Vercel (WAF) o un
    límite en el borde.
- **La validación DNS del conector se hace justo antes de cada envío**, pero
  entre la resolución y la conexión hay un instante. Con un TTL de DNS
  mínimo, un atacante con control del dominio y acceso de administrador al
  CRM podría todavía apuntar a una IP interna. Mitigación de fondo: un proxy
  de salida.
- **`style-src 'unsafe-inline'`.** Hace falta para los atributos `style` de
  los gráficos. No permite ejecutar scripts.
