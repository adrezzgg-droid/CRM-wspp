# Traspaso a Claude Code

## Cómo usar este paquete

1. En [claude.ai/code](https://claude.ai/code), abrí el selector de entorno (ícono de nube sobre la caja de mensaje) y confirmá que **Network access** esté en **Trusted** (o Full).
2. Creá un repositorio vacío en GitHub (por ejemplo `crm-whatsapp`) y conectalo a la sesión.
3. Subí el contenido de esta carpeta al repositorio (la raíz debe tener `CLAUDE.md`, `firestore.rules`, `src/` y `docs/`).
4. Pegá el texto de abajo como primer mensaje de la sesión.

## Mensaje de arranque

```
Retomamos el proyecto CRM de WhatsApp. Leé CLAUDE.md y docs/ESPECIFICACION.md
antes de hacer nada.

Ya hay hecho: la matriz de permisos con tests (src/server/permissions), el modelo
de datos de Firestore (src/types/model.ts) y las reglas de seguridad
(firestore.rules). No los reemplaces sin explicarme por qué.

Seguí con la FASE 1:
1. Crear el proyecto Next.js + TypeScript + Tailwind en este repositorio,
   conservando los archivos existentes.
2. Firebase: cliente (solo lectura) y Admin SDK en servidor, .env.example con
   todas las variables, sin secretos en el código.
3. Autenticación: login con Firebase Auth, sesión por cookie en el servidor,
   custom claims (orgId, role), protección de rutas y de endpoints con la matriz
   de permisos.
4. Layout: sidebar filtrada por permisos, topbar, banner visible de modo DEMO,
   páginas base de cada módulo, responsive (desktop primero, tablet y móvil).
5. firestore.indexes.json y pruebas de las reglas con el emulador.
6. Cerrar la fase: build, typecheck, lint, tests, rutas, permisos, responsive y
   errores. Explicame qué quedó funcionando y qué falta.

No pases a la Fase 2 hasta que yo lo confirme.
```

## Fases

1. Arquitectura + base de datos + autenticación + layout
2. Clientes + usuarios + roles
3. Inbox + conversaciones + mensajes
4. Asignación de vendedores
5. Pipeline comercial
6. Tareas + seguimiento
7. Automatizaciones
8. Dashboard y métricas
9. Integración real con WhatsApp Cloud API
10. Pruebas + seguridad + optimización

## Cosas que dependen de vos (no de Claude)

- **Firebase:** crear un proyecto nuevo para el CRM (distinto del de gestión) y habilitar Authentication y Firestore.
- **Vercel:** conectar el repositorio cuando la Fase 1 esté lista.
- **Meta (Fase 9):** cuenta de Meta Business verificada, número de WhatsApp y app con el producto WhatsApp. La verificación del negocio puede demorar días, conviene iniciarla antes de llegar a esa fase.
