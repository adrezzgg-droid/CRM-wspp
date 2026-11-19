# Puesta en producción (WhatsApp real)

Pasos para dejar el CRM publicado y conectado a WhatsApp Cloud API. El demo
sigue funcionando igual: la empresa "demo" nunca se conecta a Meta.

## 1. Firebase (proyecto real)

1. Crear un proyecto en console.firebase.google.com y habilitar:
   - **Authentication**, con email y contraseña;
   - **Firestore**, en modo producción;
   - **Storage**.
2. Publicar las reglas y los índices:
   ```
   firebase deploy --only firestore:rules,firestore:indexes,storage
   ```
   `firestore.indexes.json` incluye la **política TTL** sobre
   `webhookEvents.expireAt`: los eventos crudos se borran solos a los 30 días.
3. **Configuración → Cuentas de servicio → Generar clave privada.** Con ese
   archivo se completan:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`

## 2. Vercel

1. Importar el repositorio y cargar **todas** las variables de
   `.env.example`, sin las de emuladores.
2. Generar las claves con estos comandos y no reutilizar las de `.env.local`:
   - `SECRETS_ENCRYPTION_KEY` (cifra los tokens; si se pierde, hay que volver
     a cargar los tokens):
     ```
     node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
     ```
   - `CRON_SECRET` y `WHATSAPP_VERIFY_TOKEN` (textos largos al azar):
     ```
     node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"
     ```
3. Configurar `APP_URL`: la dirección pública, por ejemplo
   `https://crm.midistribuidora.com`.
4. **Cron.** `vercel.json` llama a `/api/cron/sla` cada 5 minutos. Esa tarea
   se ocupa de las alertas de demora, las tareas vencidas, las automatizaciones,
   los reintentos de webhooks y la cola de envíos a gestión.
   - En el plan Hobby, Vercel solo permite crons **diarios**. Opciones: el plan
     Pro, o un cron externo (cron-job.org, GitHub Actions) que llame a la URL
     cada 5 min con `Authorization: Bearer <CRON_SECRET>`.
5. **No** definir `WHATSAPP_GRAPH_BASE_URL`: es solo para el simulador de
   pruebas.

## 3. Crear la empresa

```
npm run org:crear -- --nombre "Mi Distribuidora" --admin-email ana@empresa.com --admin-nombre "Ana López"
```

Se corre con las variables del proyecto real. Imprime un enlace para que el
administrador defina su contraseña.

## 4. Meta (WhatsApp Cloud API)

1. **Verificar la empresa** en business.facebook.com → Configuración → Centro
   de seguridad. Sin verificación hay límite de conversaciones.
2. En **developers.facebook.com**:
   - crear una app de tipo **Empresa**;
   - agregarle el producto **WhatsApp**.
3. **App Secret.** En Configuración de la app → Básica → **Clave secreta**,
   copiarlo a `WHATSAPP_APP_SECRET` en Vercel.
4. **Número.** En WhatsApp → Configuración de la API, agregar el número de
   producción.
   - No puede estar usándose en la app común de WhatsApp: hay que darlo de
     baja o migrarlo.
   - Para probar antes, alcanza con el número de prueba que da Meta, con los
     destinatarios de prueba agregados.
5. **Token permanente.** En Business Manager → **Usuarios del sistema**:
   - crear un usuario administrador;
   - asignarle la app y la cuenta de WhatsApp;
   - generar el token con los permisos `whatsapp_business_messaging` y
     `whatsapp_business_management`.
6. **Conectar en el CRM.** En **Configuración → WhatsApp**, pegar el Phone
   Number ID, el WABA ID y el token, y tocar **Conectar**.
   - El CRM prueba los datos contra Meta y suscribe la app a la cuenta antes
     de guardarlos.
7. **Webhook en Meta.** En WhatsApp → Configuración → Webhook:
   - pegar la **URL** y el **Verify Token** que muestra el CRM;
   - suscribir los campos `messages` y `message_template_status_update`.
   - Al verificarse, el CRM marca "Webhook verificado".
8. **Plantillas.** En **Configuración → Plantillas**, crear las plantillas y
   tocar **Enviar a Meta**. La aprobación llega sola; si hace falta, está el
   botón **Sincronizar con Meta**.

## 5. Prueba final

1. Mandar un WhatsApp al número desde un celular: tiene que aparecer en la
   bandeja.
2. Responder desde el CRM: tiene que llegar al celular, con los tildes de
   entregado y leído.
3. Si no aparece nada:
   - revisar en Configuración → WhatsApp el "Último webhook recibido";
   - revisar los logs de Vercel, donde una firma inválida se registra como
     `[webhook] firma inválida`.

## Si una empresa usa su propia app de Meta

La empresa puede cargar el **App Secret** de su app en Configuración → WhatsApp.
- Los webhooks de esa empresa se validan con ese secreto.
- Nadie puede inyectar mensajes en otra empresa con la firma de su app.
- En Meta, el webhook de esa app usa la misma URL y el Verify Token que
  muestra el CRM.

## Probar todo sin Meta (desarrollo)

```
npm run emulators
npm run dev
npm run test:whatsapp
```

`npm run emulators` y `npm run dev` van cada uno en su propia terminal.
`npm run test:whatsapp` levanta un simulador de la Graph API en el puerto 4010
y recorre todo el circuito real con la empresa de prueba "prueba-real":
conexión, webhook firmado, envío y archivos, plantillas, token vencido y el
conector con gestión.
