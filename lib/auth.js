import crypto from "node:crypto";
import { promisify } from "node:util";
import { neon } from "@neondatabase/serverless";

const pbkdf2 = promisify(crypto.pbkdf2);
const PASSWORD_ITERATIONS = 310000;

export const SESSION_COOKIE = "posy_session";
export const SESSION_DURATION = 8 * 60 * 60;

export function getDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL non configurée.");
  }
  return neon(process.env.DATABASE_URL);
}

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await pbkdf2(password, salt, PASSWORD_ITERATIONS, 32, "sha256");
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export async function verifyPassword(password, storedHash) {
  try {
    const parts = storedHash.split("$");

    if (parts.length !== 4 || parts[0] !== "pbkdf2") {
      return false;
    }

    const iterations = Number(parts[1]);
    // 31 000 itérations : ancien format déjà utilisé par le compte principal.
    if (!Number.isInteger(iterations) || iterations < 31000 || iterations > 1000000) {
      return false;
    }

    const salt = Buffer.from(parts[2], "base64");
    const expected = Buffer.from(parts[3], "base64");

    if (salt.length !== 16 || expected.length !== 32) {
      return false;
    }

    const actual = await pbkdf2(password, salt, iterations, expected.length, "sha256");
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function createSessionToken() {
  return crypto.randomBytes(32).toString("base64url");
}

export function hashSessionToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function getCookie(req, name) {
  const cookies = req.headers.cookie || "";

  for (const item of cookies.split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) {
      return value.join("=");
    }
  }

  return null;
}

export function setSessionCookie(res, token) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${SESSION_DURATION}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`
  );
}
