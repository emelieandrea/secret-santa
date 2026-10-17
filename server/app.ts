import { pinDigest, validPin } from "./pin.ts";
import express from "express";
import { createHash } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { draw, token } from "./session.ts";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "2kb" }));
app.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});
const hash = (secret: string) =>
  createHash("sha256").update(secret).digest("hex");
type Result =
  | {
      id: string;
      people: { id: string; name: string }[];
      me: string;
      isHost: boolean;
      drawn: boolean;
      recipient: string | null;
      expires: number;
      requiresPin?: boolean;
    }
  | { status: number; error: string };
type Database = {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: {
      santa_action: {
        Args: {
          action: string;
          session_id: string;
          secret_hash: string;
          payload: object;
        };
        Returns: Result;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
class BackendError extends Error {
  diagnostic: {
    stage: string;
    code: string;
    status?: number;
    missing?: string[];
  };
  constructor(diagnostic: {
    stage: string;
    code: string;
    status?: number;
    missing?: string[];
  }) {
    super("Session backend failed");
    this.diagnostic = diagnostic;
  }
}
let client: SupabaseClient<Database> | undefined;
function database() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (
    !url ||
    !key ||
    !process.env.PIN_SECRET ||
    process.env.PIN_SECRET.length < 32
  ) {
    throw new BackendError({
      stage: "configuration",
      code: "MISSING_ENVIRONMENT_VARIABLE",
      missing: [
        !url && "SUPABASE_URL",
        !key && "SUPABASE_SECRET_KEY",
        (!process.env.PIN_SECRET || process.env.PIN_SECRET.length < 32) &&
          "PIN_SECRET (minst 32 tecken)",
      ].filter(Boolean) as string[],
    });
  }
  try {
    new URL(url);
  } catch {
    throw new BackendError({
      stage: "configuration",
      code: "INVALID_SUPABASE_URL",
    });
  }
  return (client ??= createClient<Database>(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }));
}
async function execute(
  action: string,
  id: string,
  secret: string,
  payload: object = {},
) {
  const { data, error, status } = await database().rpc("santa_action", {
    action,
    session_id: id,
    secret_hash: hash(secret),
    payload,
  });
  if (error) {
    // Do not return database errors or credentials to the browser.
    // Log only a bounded error code and HTTP status, never database messages,
    // request payloads, participant keys, names or assignments.
    const code = /^[A-Z0-9_]{1,32}$/i.test(error.code || "")
      ? error.code
      : "DATABASE_REQUEST_FAILED";
    throw new BackendError({ stage: "supabase_rpc", code, status });
  }
  if (!data)
    throw new BackendError({
      stage: "supabase_rpc",
      code: "EMPTY_RESPONSE",
      status,
    });
  return data;
}
app.use((req, res, next) => {
  if (["POST", "DELETE"].includes(req.method) && req.headers.origin) {
    const origin =
      process.env.PUBLIC_ORIGIN ||
      `${process.env.VERCEL ? "https" : req.protocol}://${req.get("host")}`;
    if (req.headers.origin !== new URL(origin).origin)
      return res.status(403).json({ error: "Förfrågan tillåts inte." });
  }
  next();
});
app.all(
  /^\/api\/sessions(?:\/([\w-]+)(?:\/(join|draw|lobby|resume|pin))?)?$/,
  async (req, res) => {
    const match = req.path.match(
      /^\/api\/sessions(?:\/([\w-]+)(?:\/(join|draw|lobby|resume|pin))?)?$/,
    )!;
    let id = match[1];
    const suffix = match[2];
    let action: string;
    if (!id && req.method === "POST") action = "create";
    else if (suffix === "join" && req.method === "POST") action = "join";
    else if (suffix === "lobby" && req.method === "GET") action = "lobby";
    else if (suffix === "resume" && req.method === "POST") action = "resume";
    else if (suffix === "pin" && req.method === "POST") action = "set_pin";
    else if (suffix === "draw" && req.method === "POST") action = "draw";
    else if (id && !suffix && req.method === "GET") action = "read";
    else if (id && !suffix && req.method === "DELETE") action = "end";
    else return res.status(405).json({ error: "Metoden stöds inte." });

    const joining = action === "create" || action === "join";
    const name = req.body?.name;
    if (
      joining &&
      (typeof name !== "string" || !name.trim() || name.trim().length > 40)
    )
      return res.status(400).json({ error: "Skriv ett namn med 1–40 tecken." });
    const needsPin = joining || action === "resume" || action === "set_pin";
    if (needsPin && !validPin(req.body?.pin))
      return res
        .status(400)
        .json({ error: "PIN-koden måste bestå av exakt fyra siffror." });
    if (
      action === "resume" &&
      !/^[\w-]{20,64}$/.test(req.body?.participantId || "")
    )
      return res.status(400).json({ error: "Välj ditt namn i listan." });
    const secret =
      joining || action === "resume" || action === "lobby"
        ? token()
        : req.headers.authorization?.match(/^Bearer ([\w-]+)$/)?.[1];
    if (!secret)
      return res.status(401).json({ error: "Du behöver gå med i sessionen." });
    id ||= token();
    const participantId = joining ? token() : req.body?.participantId;
    let payload: object = joining
      ? {
          name: name.trim(),
          participant_id: participantId,
          pin_hash: pinDigest(id, participantId, req.body.pin),
        }
      : action === "resume"
        ? {
            participant_id: participantId,
            pin_hash: pinDigest(id, participantId, req.body.pin),
          }
        : {};
    if (action === "set_pin") {
      const current = await execute("read", id, secret);
      if ("status" in current)
        return res.status(current.status).json({ error: current.error });
      payload = { pin_hash: pinDigest(id, current.me, req.body.pin) };
    }
    if (action === "draw") {
      const current = await execute("read", id, secret);
      if ("status" in current)
        return res.status(current.status).json({ error: current.error });
      if (!current.isHost)
        return res
          .status(403)
          .json({ error: "Bara värden kan starta lottningen." });
      if (current.drawn)
        return res.status(409).json({ error: "Lottningen är redan klar." });
      if (current.people.length < 2)
        return res.status(400).json({ error: "Minst två deltagare behövs." });
      const ids = current.people.map((p: { id: string }) => p.id);
      payload = { ids, matches: Object.fromEntries(draw(ids)) };
    }
    const result = await execute(action, id, secret, payload);
    if ("status" in result)
      return res.status(result.status).json({ error: result.error });
    if (action === "end") return res.sendStatus(204);
    return res
      .status(joining ? 201 : 200)
      .json({
        ...result,
        ...(joining || action === "resume" ? { secret } : {}),
      });
  },
);
app.use((_req, res) => res.status(404).json({ error: "Sidan finns inte." }));
app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    if (!(err instanceof SyntaxError)) {
      console.error(
        "Secret Santa backend:",
        JSON.stringify(
          err instanceof BackendError
            ? err.diagnostic
            : { stage: "runtime", code: "UNEXPECTED_ERROR" },
        ),
      );
    }
    res.status(err instanceof SyntaxError ? 400 : 503).json({
      error:
        err instanceof SyntaxError
          ? "Ogiltig förfrågan."
          : "Sessionstjänsten är inte tillgänglig. Försök igen senare.",
    });
  },
);
export default app;
