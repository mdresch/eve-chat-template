import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";

function getKey() {
  const raw = process.env.MODEL_KEY_ENCRYPTION_SECRET;

  if (!raw) {
    throw new Error("Missing MODEL_KEY_ENCRYPTION_SECRET.");
  }

  const key = Buffer.from(raw, "base64");

  if (key.length !== 32) {
    throw new Error("MODEL_KEY_ENCRYPTION_SECRET must decode to 32 bytes.");
  }

  return key;
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return [iv, cipher.getAuthTag(), ciphertext].map((buffer) => buffer.toString("base64")).join(".");
}

export function decryptSecret(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(".");

  if (!ivB64 || !tagB64 || !dataB64) {
    throw new Error("Malformed encrypted payload.");
  }

  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivB64, "base64"));

  decipher.setAuthTag(Buffer.from(tagB64, "base64"));

  return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString("utf8");
}
