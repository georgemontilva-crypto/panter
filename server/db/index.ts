import { resolve } from "node:path";
import mysql from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import { migrate } from "drizzle-orm/mysql2/migrator";
import * as schema from "./schema";
import { env } from "../env";

export let db: MySql2Database<typeof schema>;
export type Tx = Parameters<Parameters<MySql2Database<typeof schema>["transaction"]>[0]>[0];

// Conecta y aplica las migraciones pendientes de la carpeta drizzle/.
// Así cada despliegue deja la base al día sin correr SQL a mano.
export async function initDb() {
  const pool = mysql.createPool({ uri: env.databaseUrl, connectionLimit: 10, timezone: "Z" });
  db = drizzle(pool, { schema, mode: "default" });
  await migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
}
