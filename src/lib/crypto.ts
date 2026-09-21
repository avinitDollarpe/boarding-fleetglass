import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
} from "crypto";

function keyBytes(): Buffer {
  const raw = process.env.INTEGRATION_SECRET_KEY;
  if (raw && /^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("Set INTEGRATION_SECRET_KEY or AUTH_SECRET");
  return scryptSync(secret, "fleetglass-integrations", 32);
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

export function decryptSecret(payload: string): string {
  const buf = Buffer.from(payload, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export function hashSecret(plain: string): string {
  return createHash("sha256").update(plain).digest("hex");
}

export function newIngestKey(): string {
  return `fg_${randomBytes(32).toString("base64url")}`;
}

export function hint(secret: string): string {
  return secret.slice(-4);
}
