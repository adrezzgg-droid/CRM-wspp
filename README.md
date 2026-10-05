# CRM de WhatsApp

Centro de operaciones comercial sobre WhatsApp: bandeja compartida, asignación de leads,
clientes, pipeline, tareas, automatizaciones y métricas. Multiempresa.

Stack: Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Firebase (Auth, Firestore) · Vercel.
Instrucciones del proyecto y decisiones: [CLAUDE.md](CLAUDE.md). Especificación: [docs/ESPECIFICACION.md](docs/ESPECIFICACION.md).

## Desarrollo local (sin cuenta de Firebase)

Requisitos: Node 22.18+ y Java 21 (para los emuladores).

```bash
npm install
npm run emulators        # en una terminal: Auth :9099, Firestore :8080, UI :4000
npm run seed:demo        # en otra: carga la organización demo
npm run dev              # http://localhost:3000
```

`.env.local` ya apunta a los emuladores. Usuarios demo: `admin@demo.test`, `supervisor@demo.test`,
`vendedor1@demo.test`, `vendedor2@demo.test`, `repartidor@demo.test`, `lectura@demo.test`
(contraseña definida en `scripts/seed-demo.ts`, válida solo en el emulador).

## Verificación

```bash
npm run check            # typecheck + lint + tests + build
npm run test:rules       # reglas de Firestore contra el emulador
```

## Producción

1. Crear un proyecto de Firebase con Authentication (email/contraseña) y Firestore.
2. Copiar `.env.example` a las variables de Vercel (las `FIREBASE_*` del servidor salen de una cuenta de servicio).
3. Publicar reglas e índices: `npx firebase deploy --only firestore --project <id>`.
4. Tareas programadas: `vercel.json` corre `/api/cron/sla` cada 5 minutos (Vercel envía `CRON_SECRET` como Bearer). El plan Hobby de Vercel solo permite crons diarios: en ese caso usar un cron externo (cron-job.org, Cloud Scheduler) que llame a esa URL con el encabezado `Authorization: Bearer <CRON_SECRET>`.
5. Crear la primera organización: `npm run org:crear -- --nombre "Empresa" --admin-email ... --admin-nombre "..."`.
