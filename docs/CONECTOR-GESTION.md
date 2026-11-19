# Conector CRM ↔ sistema de gestión

Contrato entre el CRM y el sistema de gestión de la distribuidora (por ejemplo,
panitas-app). No comparten base de datos: se hablan por HTTP, con mensajes
firmados en las dos direcciones.

Se configura en **Configuración → Integraciones** del CRM, con:

- **Dirección de recepción**: la URL `https://…` del sistema de gestión que
  recibe los pedidos.
- **Secreto compartido**: lo genera el CRM. Hay que cargarlo también en el
  sistema de gestión.

## 1. CRM → gestión: pedidos

Cuando un pedido se **confirma** (y, si se eligió, cuando se **cancela** un
pedido que ya se había enviado), el CRM manda:

```http
POST <dirección de recepción>
Content-Type: application/json
X-CRM-Event: order.confirmed            (u order.cancelled, o ping en la prueba)
X-CRM-Delivery: 8Jq3…                   (id único del envío)
X-CRM-Signature: sha256=<hex>           (HMAC-SHA256 del cuerpo con el secreto)

{
  "id": "8Jq3…",
  "event": "order.confirmed",
  "orgId": "mi-distribuidora",
  "createdAt": 1795000000000,
  "data": {
    "orderId": "aB12…",                 // id del pedido en el CRM
    "number": "P-000123",
    "customerId": "c9…",
    "customerName": "Pollería Don José",
    "sellerId": "u7…",
    "items": [{ "productId": "pec", "name": "Pechuga sin hueso", "qty": 10, "unitPrice": 6900 }],
    "total": 69000,
    "currency": "ARS",
    "deliveryAddress": "Av. Colón 1234",
    "deliveryDate": null,
    "notes": null,
    "externalId": null,                 // id en gestión, si ya lo informó
    "cancelReason": "…"                 // solo en order.cancelled
  }
}
```

**Qué tiene que hacer el sistema de gestión:**

1. **Verificar la firma** antes de procesar:
   - calcular `HMAC-SHA256(cuerpo crudo, secreto)`;
   - compararlo con `X-CRM-Signature` (sin el prefijo `sha256=`), en tiempo
     constante;
   - si no coincide, responder **401**.
2. **No procesar dos veces el mismo envío.** Guardar los `X-CRM-Delivery` ya
   recibidos y, si se repite, responder 200 sin hacer nada. El CRM reintenta
   cuando no recibe respuesta, así que el mismo envío puede llegar más de una vez.
3. **Responder 2xx** cuando el pedido quedó guardado.

**Reintentos:**
- Error de red, sin respuesta en 15 s, 408, 429 o 5xx: el CRM reintenta a
  1 min, 5 min, 15 min, 1 h, 3 h, 6 h, 12 h y 24 h. Después queda en error.
- Cualquier otro 4xx: el envío queda en error sin reintentar, porque el
  contenido fue rechazado.
- En ambos casos se ve en "Últimos envíos", con un botón para reintentar.

**Ejemplo de verificación (Node):**

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function firmaValida(cuerpoCrudo, header, secreto) {
  const esperado = Buffer.from(`sha256=${createHmac("sha256", secreto).update(cuerpoCrudo).digest("hex")}`);
  const recibido = Buffer.from(String(header ?? "").toLowerCase());
  return recibido.length === esperado.length && timingSafeEqual(recibido, esperado);
}
```

Hay que usar el cuerpo **crudo**, tal como llegó. Si se lo parsea y se lo
vuelve a serializar, la firma ya no coincide.

## 2. Gestión → CRM: estado del reparto

```http
POST https://<crm>/api/integrations/gestion/<orgId>
Content-Type: application/json
X-CRM-Signature: sha256=<HMAC-SHA256 del cuerpo con el mismo secreto>

{ "data": { "orderId": "aB12…", "status": "en_reparto", "externalId": "G-4567" } }
```

**Campos:**
- `orderId` (el id del CRM) **o** `number` (`P-000123`).
- `status`: `en_preparacion`, `en_reparto`, `entregado` o `cancelado`.
- `externalId`: opcional. Es el id del pedido en gestión; queda guardado en
  `order.deliveryRef`.
- `reason`: opcional, para `cancelado`.

**Respuestas:**

| Código | Cuándo |
|---|---|
| 200 | `{ ok: true, order: "P-000123", status: "entregado" }` |
| 401 | La firma es inválida o la empresa no existe (no se distingue a propósito). |
| 404 | El pedido no existe. |
| 409 | La transición no es posible (por ejemplo, entregar un pedido cancelado). |
| 422 | Faltan datos. |

**Cómo se aplica en el CRM:**
- **Se pueden saltear pasos.** Si informa `entregado` sobre un pedido
  confirmado, el CRM lo pasa por preparación y reparto, y cada paso queda en
  el historial como "Sistema de gestión".
- **Sin eco.** Un cambio que informa gestión no se le vuelve a mandar.
- **El vendedor se entera de la entrega** con un aviso.

## Dónde está el código

- **Salida:** `src/server/connectors/outbox-core.ts` (cola, firma, reintentos).
  La procesa la tarea programada `/api/cron/sla`.
- **Entrada:** `src/server/connectors/service.ts` → `receiveGestionStatus`.
- **Pruebas:** `tests/inbox/outbox.test.ts` y `tests/api/whatsapp-real.test.ts`.
