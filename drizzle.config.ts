import { defineConfig } from "drizzle-kit";

// `npm run db:generate` compara server/db/schema.ts con las migraciones existentes
// y escribe una nueva en drizzle/. El servidor las aplica solo al arrancar.
export default defineConfig({
  dialect: "mysql",
  schema: "./server/db/schema.ts",
  out: "./drizzle",
});
