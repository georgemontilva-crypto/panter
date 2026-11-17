const isProd = process.env.NODE_ENV === "production";

export const env = {
  isProd,
  port: Number(process.env.PORT) || 3000,
  // Railway: DATABASE_URL = ${{MySQL.MYSQL_URL}}
  databaseUrl: process.env.DATABASE_URL || process.env.MYSQL_URL || "",
  // Firma de las sesiones. Es obligatoria: sin ella el sistema de cuentas no arranca.
  jwtSecret: process.env.JWT_SECRET || "",
  // Primer administrador: se crea al arrancar si todavía no existe ninguno.
  adminPhone: process.env.ADMIN_PHONE || "",
  adminPassword: process.env.ADMIN_PASSWORD || "",
  adminName: process.env.ADMIN_NAME || "Administrador",
};

export const accountsEnabled = () => Boolean(env.databaseUrl && env.jwtSecret);
