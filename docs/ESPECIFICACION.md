QUIERO QUE DESARROLLES UNA APLICACIÓN CRM PROFESIONAL PARA WHATSAPP, ORIENTADA PRINCIPALMENTE A EQUIPOS COMERCIALES, DISTRIBUIDORAS Y EMPRESAS QUE RECIBEN MUCHOS MENSAJES Y LEADS POR WHATSAPP.

IMPORTANTE:
No quiero una maqueta estática ni solamente una interfaz visual.
Quiero una aplicación funcional, modular y preparada para conectarse realmente con WhatsApp mediante la WhatsApp Business Platform / Meta Cloud API.

OBJETIVO PRINCIPAL

Crear un CRM que permita centralizar las conversaciones de WhatsApp, administrar clientes y prospectos, asignar conversaciones a vendedores, hacer seguimiento comercial y medir resultados.

La aplicación debe funcionar como un centro de operaciones comercial.

==================================================
1. ARQUITECTURA GENERAL
==================================================

Crear una arquitectura profesional, escalable y modular.

Separar claramente:

- Frontend
- Backend
- Base de datos
- Autenticación
- Integración con WhatsApp
- Webhooks
- Automatizaciones
- Sistema de permisos
- Analytics

Utilizar tecnologías modernas y mantenibles.

Preferentemente:

- React
- TypeScript
- Tailwind CSS
- Node.js / API
- PostgreSQL o Supabase
- API REST
- Webhooks
- Componentes reutilizables

Si considerás otra arquitectura superior, explicarla antes de implementarla.

NO utilizar datos falsos como solución definitiva.

Los datos de demostración pueden existir únicamente para mostrar el funcionamiento inicial.

==================================================
2. INTEGRACIÓN CON WHATSAPP
==================================================

La aplicación debe estar preparada para integrarse con:

Meta WhatsApp Business Platform
WhatsApp Cloud API
Webhooks de Meta

Debe existir una sección:

CONFIGURACIÓN → WHATSAPP

con:

- Número conectado
- Phone Number ID
- WhatsApp Business Account ID
- Access Token
- Webhook URL
- Verify Token
- Estado de conexión
- Estado del webhook
- Última sincronización
- Prueba de conexión

IMPORTANTE:

Nunca guardar tokens sensibles directamente en el frontend.

Las credenciales deben almacenarse de manera segura en backend / variables de entorno / secrets.

La aplicación debe permitir recibir:

- mensajes de texto
- imágenes
- documentos
- audios
- videos
- ubicaciones
- contactos
- respuestas a botones
- respuestas a listas

Registrar fecha y hora de cada mensaje.

Mantener historial completo de conversaciones.

==================================================
3. BANDEJA DE ENTRADA
==================================================

Crear una bandeja de entrada tipo CRM profesional.

Diseño:

Panel izquierdo:
- conversaciones

Panel central:
- conversación actual

Panel derecho:
- información del cliente

Filtros:

- Todos
- Sin asignar
- Pendientes
- En atención
- Mis conversaciones
- No respondidos
- Nuevos leads
- Clientes
- Cerrados

Cada conversación debe mostrar:

- nombre
- teléfono
- foto
- último mensaje
- fecha
- hora
- vendedor asignado
- etiquetas
- estado
- prioridad
- cantidad de mensajes sin leer

Permitir:

- responder
- enviar archivos
- enviar imágenes
- enviar documentos
- agregar notas internas
- asignar vendedor
- reasignar vendedor
- cambiar estado
- agregar etiquetas
- crear tarea
- crear cliente
- crear oportunidad
- cerrar conversación

==================================================
4. ASIGNACIÓN DE LEADS
==================================================

Crear sistema de asignación de conversaciones.

Un administrador podrá asignar una conversación a:

- vendedor
- equipo
- supervisor

Permitir asignación manual.

También crear reglas automáticas.

Ejemplos:

Si entra un nuevo cliente:
→ asignar automáticamente a vendedor disponible.

Si pertenece a determinada zona:
→ asignar al vendedor correspondiente.

Si es un cliente existente:
→ mantener el vendedor responsable anterior.

Si el vendedor no responde durante X minutos:
→ generar alerta.

Registrar toda la trazabilidad:

Lead recibido
→ asignado
→ contactado
→ en negociación
→ pedido generado
→ venta realizada
→ cerrado

==================================================
5. USUARIOS Y ROLES
==================================================

Crear sistema de usuarios.

Roles:

ADMINISTRADOR
SUPERVISOR
VENDEDOR
REPARTIDOR
SOLO LECTURA

Permisos configurables.

ADMINISTRADOR:

- ve todo
- configura WhatsApp
- administra usuarios
- asigna conversaciones
- configura automatizaciones
- ve estadísticas
- administra clientes
- administra productos
- configura CRM

SUPERVISOR:

- ve su equipo
- asigna leads
- controla conversaciones
- ve estadísticas

VENDEDOR:

- ve sus conversaciones
- atiende clientes
- crea pedidos
- agrega notas
- realiza seguimiento

SOLO LECTURA:

- únicamente consulta información.

==================================================
6. CLIENTES
==================================================

Crear módulo CLIENTES.

Cada cliente debe tener:

- ID
- Nombre
- Empresa
- Teléfono
- WhatsApp
- Email
- Dirección
- Barrio
- Zona
- Localidad
- Tipo de cliente
- Rubro
- Vendedor asignado
- Estado
- Fecha de alta
- Último contacto
- Última compra
- Total comprado
- Cantidad de pedidos
- Ticket promedio
- Etiquetas
- Notas
- Historial de conversaciones
- Historial de pedidos
- Historial de llamadas
- Tareas pendientes

Tipos:

- Prospecto
- Cliente nuevo
- Cliente activo
- Cliente inactivo
- Cliente perdido

==================================================
7. FICHA 360° DEL CLIENTE
==================================================

Crear una vista profesional del cliente.

Debe mostrar:

DATOS DEL CLIENTE

CONVERSACIONES

PEDIDOS

VENTAS

ACTIVIDADES

TAREAS

NOTAS

HISTORIAL

ÚLTIMO CONTACTO

PRÓXIMA ACCIÓN

Toda la información debe estar conectada.

==================================================
8. PIPELINE COMERCIAL
==================================================

Crear un pipeline visual tipo Kanban.

Etapas:

NUEVO LEAD
CONTACTADO
INTERESADO
COTIZACIÓN
NEGOCIACIÓN
PEDIDO
VENTA
SEGUIMIENTO
PERDIDO

Permitir mover oportunidades mediante drag & drop.

Cada oportunidad debe tener:

- cliente
- vendedor
- valor estimado
- producto
- fecha
- etapa
- probabilidad
- próxima acción
- notas

==================================================
9. AUTOMATIZACIONES
==================================================

Crear un módulo AUTOMATIZACIONES.

Permitir crear reglas como:

SI:
entra un nuevo WhatsApp

ENTONCES:
crear lead
asignar vendedor
agregar etiqueta
enviar mensaje automático
crear tarea

Otro ejemplo:

SI:
cliente no responde durante 24 horas

ENTONCES:
crear tarea de seguimiento.

Otro:

SI:
cliente realiza pedido

ENTONCES:
cambiar estado a CLIENTE ACTIVO.

Otro:

SI:
cliente no compra durante 30 días

ENTONCES:
marcar como CLIENTE PARA REACTIVAR.

==================================================
10. MENSAJES AUTOMÁTICOS
==================================================

Crear sección:

PLANTILLAS DE WHATSAPP

Permitir guardar:

- nombre
- categoría
- mensaje
- variables

Variables:

{{nombre}}
{{empresa}}
{{vendedor}}
{{pedido}}
{{fecha}}
{{importe}}

Ejemplos:

Mensaje de bienvenida.

Mensaje de seguimiento.

Mensaje de reactivación.

Mensaje de confirmación de pedido.

Mensaje de postventa.

IMPORTANTE:

La aplicación debe contemplar las restricciones de Meta para mensajes iniciados por la empresa y utilizar plantillas aprobadas cuando corresponda.

==================================================
11. ETIQUETAS
==================================================

Sistema de etiquetas personalizables.

Ejemplos:

NUEVO
URGENTE
MAYORISTA
RESTAURANTE
ALMACÉN
POLLERÍA
REACTIVAR
PEDIDO
POTENCIAL
CLIENTE ACTIVO

Permitir crear colores y nombres personalizados.

==================================================
12. TAREAS Y SEGUIMIENTO
==================================================

Crear sistema de tareas.

Cada vendedor podrá crear:

- llamada
- WhatsApp
- visita
- seguimiento
- cotización
- postventa

Campos:

Cliente
Responsable
Fecha
Hora
Tipo
Prioridad
Estado
Descripción

Dashboard de tareas:

HOY
VENCIDAS
PRÓXIMAS
COMPLETADAS

==================================================
13. DASHBOARD
==================================================

Crear dashboard profesional.

KPIs:

- nuevos leads
- leads atendidos
- leads sin responder
- conversaciones abiertas
- conversaciones cerradas
- ventas
- monto vendido
- clientes nuevos
- clientes reactivados
- tasa de conversión
- tiempo promedio de respuesta
- ventas por vendedor
- leads por vendedor
- pedidos por vendedor
- clientes perdidos
- clientes para reactivar

Gráficos:

- leads por día
- ventas por día
- conversiones
- rendimiento por vendedor
- embudo comercial
- conversaciones por estado
- clientes nuevos vs recurrentes

Filtros:

- hoy
- ayer
- últimos 7 días
- últimos 30 días
- mes actual
- mes anterior
- rango personalizado

==================================================
14. TRAZABILIDAD
==================================================

MUY IMPORTANTE.

Registrar todas las acciones.

Ejemplo:

08:32 Lead recibido
08:33 Asignado a Juan
08:35 Juan respondió
08:41 Cliente consultó precio
08:45 Se envió cotización
09:10 Cliente confirmó pedido
09:15 Pedido creado
09:30 Conversación cerrada

Crear historial de actividad.

Ninguna modificación importante debe perder el historial anterior.

==================================================
15. NOTIFICACIONES
==================================================

Crear sistema de notificaciones.

Ejemplos:

Nuevo lead.

Nuevo mensaje.

Lead sin responder.

Tarea vencida.

Cliente esperando respuesta.

Nueva asignación.

Pedido generado.

Cliente para reactivar.

Las notificaciones deben poder configurarse por usuario.

==================================================
16. BÚSQUEDA GLOBAL
==================================================

Crear buscador global.

Buscar por:

- nombre
- teléfono
- empresa
- dirección
- vendedor
- etiqueta
- número de pedido

La búsqueda debe ser rápida.

==================================================
17. CONFIGURACIÓN
==================================================

Crear:

CONFIGURACIÓN GENERAL

EMPRESA

USUARIOS

ROLES

WHATSAPP

PLANTILLAS

ETIQUETAS

AUTOMATIZACIONES

ZONAS

NOTIFICACIONES

INTEGRACIONES

==================================================
18. INTEGRACIONES FUTURAS
==================================================

Diseñar la arquitectura para poder agregar posteriormente:

- Google Sheets
- Mercado Pago
- sistemas de pedidos
- ERP
- sistemas de reparto
- email
- Instagram
- Facebook Messenger
- API externa
- Power BI

No implementar todas ahora.

Dejar una arquitectura preparada para conectores.

==================================================
19. DISEÑO
==================================================

La interfaz debe verse como un software SaaS profesional.

Inspiración funcional:

HubSpot
Kommo
Intercom
Respond.io
WATI

PERO NO COPIAR SU DISEÑO.

Crear una identidad propia.

Diseño:

- moderno
- limpio
- profesional
- rápido
- responsive
- desktop primero
- adaptado a tablet y móvil

Utilizar sidebar.

Dashboard con tarjetas KPI.

Tablas profesionales.

Kanban.

Chat tipo WhatsApp.

Badges de estados.

Filtros.

Modales.

Tooltips.

==================================================
20. EXPERIENCIA DEL VENDEDOR
==================================================

El vendedor debe poder entrar y entender inmediatamente:

"¿Qué tengo que hacer hoy?"

Mostrar:

NUEVOS LEADS
MENSAJES SIN RESPONDER
TAREAS DE HOY
CLIENTES PARA SEGUIR
OPORTUNIDADES
PEDIDOS DEL DÍA

Crear una sección:

MI DÍA

donde el vendedor pueda trabajar toda su jornada.

==================================================
21. EXPERIENCIA DEL ADMINISTRADOR
==================================================

El administrador debe poder saber:

¿Cuántos leads entraron?

¿Cuántos fueron atendidos?

¿Cuánto tardamos en responder?

¿Quién atendió cada lead?

¿Cuántos se convirtieron?

¿Cuánto vendió cada vendedor?

¿Cuántos clientes están inactivos?

¿Cuántos clientes hay que reactivar?

==================================================
22. BASE DE DATOS
==================================================

Crear una estructura de base de datos profesional.

Tablas mínimas:

users
roles
permissions
teams
customers
contacts
conversations
messages
message_attachments
conversation_assignments
tags
customer_tags
leads
opportunities
pipeline_stages
tasks
activities
notes
whatsapp_accounts
whatsapp_templates
automations
automation_actions
notifications
audit_logs

Agregar relaciones y claves necesarias.

==================================================
23. SEGURIDAD
==================================================

Implementar:

- autenticación
- autorización por roles
- protección de endpoints
- validación de datos
- manejo seguro de tokens
- variables de entorno
- protección contra acceso no autorizado
- logs
- auditoría

Nunca exponer Access Tokens de WhatsApp en el frontend.

==================================================
24. MODO DEMO
==================================================

Crear un modo DEMO para poder probar el CRM antes de conectar WhatsApp.

Debe permitir:

- crear conversaciones ficticias
- crear clientes
- asignar vendedores
- enviar mensajes simulados
- mover oportunidades
- crear pedidos
- probar automatizaciones
- visualizar dashboard

Pero separar claramente:

DEMO

de

DATOS REALES.

==================================================
25. IMPLEMENTACIÓN
==================================================

NO quiero que desarrolles todo de una sola vez sin verificar.

Trabajar por fases.

FASE 1
Arquitectura + base de datos + autenticación + layout.

FASE 2
Clientes + usuarios + roles.

FASE 3
Inbox + conversaciones + mensajes.

FASE 4
Asignación de vendedores.

FASE 5
Pipeline comercial.

FASE 6
Tareas + seguimiento.

FASE 7
Automatizaciones.

FASE 8
Dashboard y métricas.

FASE 9
Integración real con WhatsApp Cloud API.

FASE 10
Pruebas + seguridad + optimización.

==================================================
REGLA MUY IMPORTANTE
==================================================

Antes de comenzar a programar:

1. Analiza el proyecto.
2. Explica la arquitectura propuesta.
3. Explica la estructura de carpetas.
4. Explica la base de datos.
5. Explica cómo funcionará la integración con WhatsApp.
6. Explica qué partes serán demo y cuáles estarán preparadas para producción.
7. Identifica dependencias necesarias.
8. Recién después comienza a desarrollar.

No reemplaces funcionalidades existentes sin explicarlo.

No elimines código funcional.

No generes una aplicación solamente visual.

Quiero una aplicación realmente funcional y preparada para producción.

Al finalizar cada fase:

- comprobar que compile
- comprobar rutas
- comprobar base de datos
- comprobar permisos
- comprobar responsive
- comprobar errores
- explicar qué quedó funcionando
- explicar qué falta

El objetivo final es tener un CRM de WhatsApp profesional donde una empresa pueda recibir todos sus mensajes, distribuir los leads entre vendedores, administrar clientes, realizar seguimiento, generar oportunidades y medir todo el proceso comercial desde un único sistema.