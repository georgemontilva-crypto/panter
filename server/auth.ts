import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { users } from "./db/schema";
import { env } from "./env";

const COOKIE = "panter_session";
const MAX_AGE_S = 60 * 60 * 24 * 30;
const secret = () => new TextEncoder().encode(env.jwtSecret);

export const hashPassword = (plain: string) => bcrypt.hash(plain, 10);
export const checkPassword = (plain: string, hash: string) => bcrypt.compare(plain, hash);

export async function startLogin(res: Response, userId: number) {
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(secret());
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    // Con HTTPS (Railway) la cookie solo viaja cifrada; en local, por HTTP, también funciona.
    secure: res.req.secure,
    maxAge: MAX_AGE_S * 1000,
    path: "/",
  });
}

export function endLogin(res: Response) {
  res.clearCookie(COOKIE, { path: "/" });
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export type SessionUser = typeof users.$inferSelect;

export async function userFromRequest(req: Request): Promise<SessionUser | null> {
  const token = readCookie(req, COOKIE);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const id = Number(payload.sub);
    if (!Number.isInteger(id)) return null;
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user && user.active ? user : null;
  } catch {
    return null;
  }
}
