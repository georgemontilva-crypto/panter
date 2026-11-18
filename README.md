# Arena Panter

Web de Arena Panter (Maracaibo) con sistema de afiliación: tarjeta con QR, saldo recargable en REF,
visitas y niveles de fidelidad, panel de caja y control de las PC.

- **Web y API:** React + Vite + tRPC + Drizzle + MySQL, un solo servicio en Railway.
- **Programa de bloqueo:** aplicación de Windows para cada PC, en [`agente-pc/`](agente-pc/README.md).

## Rutas

| Ruta | Para quién | Qué hace |
| --- | --- | --- |
| `/` | Público | Portada, evento, estaciones, horario |
| `/cuenta` | Clientes | Registro con correo, teléfono celular y contraseña; tarjeta digital con QR, saldo, visitas, activar una PC |
| `/caja` | Cajeros y administradores | Entrada propia del personal (`/admin` lleva aquí). Clientes, recargas, cobro del menú con el saldo, venta de tarjeta, estaciones, cierre del día |
| `/caja` → Ajustes | Administradores | Tarifas, horario, menú del mostrador, estaciones y credenciales, personal, base de clientes |
| `POST /api/agent/heartbeat` | Programa de bloqueo | Cada PC pregunta su estado con su credencial |

## Variables de entorno

| Variable | Obligatoria | Para qué |
| --- | --- | --- |
| `DATABASE_URL` | Sí | Conexión a MySQL. En Railway: `${{MySQL.MYSQL_URL}}` |
| `JWT_SECRET` | Sí | Firma de las sesiones. Un texto largo y aleatorio |
| `ADMIN_PHONE` | Solo la primera vez | Teléfono del primer administrador |
| `ADMIN_PASSWORD` | Solo la primera vez | Contraseña del primer administrador |
| `ADMIN_NAME` | No | Nombre del primer administrador |

Sin `DATABASE_URL` o sin `JWT_SECRET` la portada funciona igual y las cuentas quedan apagadas.

## Base de datos

Las migraciones están en `drizzle/` y **se aplican solas al arrancar el servidor**. No hay que correr SQL a mano.
Si cambias `server/db/schema.ts`, genera la migración nueva con `npm run db:generate` y súbela con el cambio.

## Comandos

```bash
npm install          # instala dependencias
npm run dev          # portada y aplicación en http://localhost:5173
npm run dev:server   # API en http://localhost:3001 (usa el archivo .env; ver .env.example)
npm run build        # revisa tipos, compila la web (dist/) y el servidor (dist-server/)
npm start            # lo que corre en producción
```

## Dónde se cambia cada cosa

| Qué | Dónde |
| --- | --- |
| Textos de la portada, horario, evento, pases | `src/content.ts` |
| Tarifas por hora, precio de la tarjeta, minutos de gracia, bono y niveles | En la web: Caja → Ajustes |
| Estaciones y credenciales de las PC | En la web: Caja → Ajustes → Estaciones |
| Reglas del saldo, sesiones y visitas | `server/services.ts` |
| Tablas | `server/db/schema.ts` |

## Cómo funciona el saldo

- El saldo se guarda en centavos de REF y cada cambio queda en `wallet_tx` (recarga, juego, devolución, bono, ajuste)
  con el cajero, la hora y el método de pago. El saldo de un cliente siempre es la suma de sus movimientos.
- Al activar una estación se cobra el tiempo completo por adelantado. Si la sesión se termina antes, se devuelve
  el tiempo no usado (se puede apagar en Ajustes).
- Al llegar a cero empiezan los minutos de gracia (5 por defecto) para guardar la partida; luego la PC se bloquea.
- **Tipos de usuario** (columna `users.role`; los permisos se aplican en `server/trpc.ts`, no solo en pantalla):

  | Tipo | Valor | Qué ve en `/caja` |
  | --- | --- | --- |
  | Súper admin (dueño) | `owner` | Todo: resumen en vivo, clientes, máquinas, cocina, fiestas, compras, cierre y ajustes. Es el único que crea o cambia administradores |
  | Administrador | `admin` | Lo mismo, salvo tocar cuentas de administradores o del dueño |
  | Operadora | `cashier` | Clientes (registrar, recargar, cobrar el menú), máquinas y cocina |
  | Cocina | `kitchen` | Solo las comandas |

  La cuenta de `ADMIN_PHONE` es el súper admin. Al actualizar una instalación anterior, ese administrador pasa a súper admin en el arranque.
- **Comandas:** al cobrar una orden con productos marcados "pasa por cocina" se crea la comanda (`orders.kitchen_status`): por preparar, en preparación, lista, entregada.
- **Fiestas** (`server/office.ts`): paquetes, cotizaciones `COT-0001` con estados borrador, enviada, aprobada, agendada y realizada, pagos por abonos y recibo `R-0001` cuando queda pagada. El recibo es un control interno, no una factura fiscal.
- **Compras:** registro de facturas de proveedores con su estado de pago.
- **App instalable (PWA):** se llama Arena Panter y abre en `/cuenta` a pantalla completa. `pwa/sw.js` es la plantilla
  del service worker; `vite.config.ts` la completa al compilar con los archivos de esa versión y la deja en `/sw.js`.
  Guarda la app en el teléfono (abre al instante y sin conexión) y nunca guarda nada de `/api`. La última tarjeta vista
  se guarda en el propio teléfono para mostrarla sin señal, y se borra al salir de la cuenta.
- **Entradas separadas:** los clientes entran solo por `/cuenta` y el personal solo por `/caja`. Una cuenta de cliente
  no abre sesión en la entrada del personal, ni al revés. El personal no se registra: lo crea un administrador en Ajustes.
- Una visita = un día con al menos una sesión, una compra o un check-in en caja.
- **Compras del menú:** el cajero escanea la tarjeta, arma el pedido y se descuenta del saldo. Si no alcanza,
  no se crea la orden ni se cobra nada. Cada orden guarda sus renglones con el nombre y el precio de ese momento
  (`orders` y `order_items`) y se puede anular, lo que devuelve el monto al saldo.
- No se vende tiempo de juego que pase de la hora de cierre (`server/closing.ts`).
