import { createHmac, randomBytes } from "node:crypto";
const localKey = randomBytes(32).toString("hex");
export function validPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^[0-9]{4}$/.test(pin);
}
export function pinDigest(
  sessionId: string,
  participantId: string,
  pin: string,
) {
  const key = process.env.PIN_SECRET;
  if (
    (process.env.SUPABASE_URL || process.env.VERCEL) &&
    (!key || key.length < 32)
  )
    throw new Error("PIN_SECRET must contain at least 32 characters");
  return createHmac("sha256", key || localKey)
    .update(JSON.stringify([sessionId, participantId, pin]))
    .digest("hex");
}
