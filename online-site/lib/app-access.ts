import { timingSafeEqual } from "node:crypto";

export type AppCredentials = { username: string; passwordRecord: string };

export async function verifyAppCredentials(header: string | null, credentials: AppCredentials): Promise<boolean> {
  if (!header || header.length > 4096) return false;
  const [scheme, encoded, extra] = header.split(" ");
  if (scheme.toLowerCase() !== "basic" || !encoded || extra) return false;
  let username: string, password: string;
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0)),
    );
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    username = decoded.slice(0, separator);
    password = decoded.slice(separator + 1);
  } catch { return false; }

  const [algorithm, iterations, saltHex, digestHex] = credentials.passwordRecord.split("$");
  if (algorithm !== "pbkdf2-sha256" || iterations !== "100000" ||
      !/^[0-9a-f]{32}$/.test(saltHex || "") || !/^[0-9a-f]{64}$/.test(digestHex || "")) {
    throw new Error("Invalid app login configuration");
  }
  const bytes = (hex: string) => Uint8Array.from(hex.match(/../g)!, (part) => parseInt(part, 16));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const digest = new Uint8Array(await crypto.subtle.deriveBits({
    name: "PBKDF2", hash: "SHA-256", iterations: 100000, salt: bytes(saltHex),
  }, key, 256));
  const validPassword = timingSafeEqual(digest, bytes(digestHex));
  return validPassword && username === credentials.username;
}


export type AppUser = { username: string; role: 'admin' | 'general' };
type LoginEnvironment = { APP_LOGIN_USERNAME?: string; APP_LOGIN_PASSWORD_RECORD?: string; APP_GENERAL_USERNAME?: string; APP_GENERAL_PASSWORD_RECORD?: string };

export async function authenticateAppUser(header: string | null, env: LoginEnvironment): Promise<AppUser | null> {
  if (!env.APP_LOGIN_USERNAME || !env.APP_LOGIN_PASSWORD_RECORD) throw new Error('App login is not configured');
  if (await verifyAppCredentials(header, {username:env.APP_LOGIN_USERNAME,passwordRecord:env.APP_LOGIN_PASSWORD_RECORD})) return {username:env.APP_LOGIN_USERNAME,role:'admin'};
  if (env.APP_GENERAL_PASSWORD_RECORD && await verifyAppCredentials(header, {username:env.APP_GENERAL_USERNAME || 'Arafat',passwordRecord:env.APP_GENERAL_PASSWORD_RECORD})) return {username:env.APP_GENERAL_USERNAME || 'Arafat',role:'general'};
  return null;
}
