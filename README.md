# Arena Panter

Web de Arena Panter (Maracaibo) con sistema de afiliación: tarjeta con QR, saldo recargable en REF,
visitas y niveles de fidelidad, panel de caja y control de las PC.

- **Web y API:** React + Vite + tRPC + Drizzle + MySQL, un solo servicio en Railway.
- **Programa de bloqueo:** aplicación de Windows para cada PC, en [`agente-pc/`](agente-pc/README.md).

## Rutas

| Ruta | Para quién | Qué hace |
| --- | --- | --- |
| `/` | Público | Portada, evento, estaciones, horario |
| `/cuenta` | Clientes | Registro, tarjeta digital con QR, saldo, visitas, activar una PC |
| `/caja` | Cajeros y administradores | Clientes, recargas, cobro del menú con el saldo, venta de tarjeta, estaciones, cierre del día |
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
- Una visita = un día con al menos una sesión, una compra o un check-in en caja.
- **Compras del menú:** el cajero escanea la tarjeta, arma el pedido y se descuenta del saldo. Si no alcanza,
  no se crea la orden ni se cobra nada. Cada orden guarda sus renglones con el nombre y el precio de ese momento
  (`orders` y `order_items`) y se puede anular, lo que devuelve el monto al saldo.
- No se vende tiempo de juego que pase de la hora de cierre (`server/closing.ts`).
