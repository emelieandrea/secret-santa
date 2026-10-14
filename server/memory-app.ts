import express from "express";
import { fileURLToPath } from "node:url";
import { draw, token, view, type Session } from "./session.ts";

const app = express();
// Set the externally visible HTTPS origin behind a reverse proxy.
const publicOrigin = process.env.PUBLIC_ORIGIN
  ? new URL(process.env.PUBLIC_ORIGIN).origin
  : null;

app.disable("x-powered-by");
app.use(express.json({ limit: "2kb" }));
app.use("/api", (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

const sessions = new Map<string, Session>();
const attempts = new Map<string, { count: number; expires: number }>();

setInterval(() => {
  for (const [id, s] of sessions)
    if (s.expires < Date.now()) sessions.delete(id);
  for (const [ip, a] of attempts)
    if (a.expires < Date.now()) attempts.delete(ip);
}, 60_000).unref();

app.use("/api", (req, res, next) => {
  if (["POST", "DELETE"].includes(req.method)) {
    if (
      req.headers.origin &&
      req.headers.origin !==
        (publicOrigin || `${req.protocol}://${req.get("host")}`)
    )
      return res.status(403).json({ error: "Förfrågan tillåts inte." });
    const ip = req.ip || "unknown";
    let a = attempts.get(ip);
    if (!a || a.expires < Date.now()) {
      a = { count: 0, expires: Date.now() + 60_000 };
      attempts.set(ip, a);
    }
    if (++a.count > 60)
      return res
        .status(429)
        .json({ error: "För många försök. Vänta en minut." });
  }
  next();
});

function name(body: unknown): string {
  const n = (body as { name?: unknown })?.name;
  if (typeof n !== "string" || !n.trim() || n.trim().length > 40)
    throw new Error("Skriv ett namn med 1–40 tecken.");
  return n.trim();
}
app.post("/api/sessions", (req, res) => {
  const n = name(req.body);
  if (sessions.size >= 1000)
    return res
      .status(503)
      .json({ error: "Det är fullt just nu. Försök senare." });
  const p = { id: token(), name: n, secret: token() };
  const s: Session = {
    id: token(),
    host: p.secret,
    people: [p],
    matches: null,
    expires: Date.now() + 6 * 60 * 60 * 1000,
  };
  sessions.set(s.id, s);
  res.status(201).json({ secret: p.secret, ...view(s, p) });
});

app.post("/api/sessions/:id/join", (req, res) => {
  const s = sessions.get(req.params.id);
  if (!s || s.expires < Date.now())
    return res
      .status(404)
      .json({ error: "Sessionen har avslutats eller finns inte." });
  if (s.matches)
    return res
      .status(409)
      .json({ error: "Lottningen är redan klar. Det går inte att gå med nu." });
  if (s.people.length >= 100)
    return res
      .status(409)
      .json({ error: "Sessionen är full (100 deltagare)." });
  const n = name(req.body);
  if (
    s.people.some(
      (p) => p.name.toLocaleLowerCase("sv") === n.toLocaleLowerCase("sv"),
    )
  )
    return res.status(409).json({
      error: "Namnet används redan. Lägg till exempel till ditt efternamn.",
    });
  const p = { id: token(), name: n, secret: token() };
  s.people.push(p);
  res.status(201).json({ secret: p.secret, ...view(s, p) });
});

app.use("/api/sessions/:id", (req, res, next) => {
  const s = sessions.get(req.params.id);
  if (!s || s.expires < Date.now())
    return res
      .status(404)
      .json({ error: "Sessionen har avslutats eller finns inte." });
  const p = s.people.find(
    (x) => `Bearer ${x.secret}` === req.headers.authorization,
  );
  if (!p)
    return res.status(401).json({ error: "Du behöver gå med i sessionen." });
  res.locals.s = s;
  res.locals.p = p;
  next();
});

app.get("/api/sessions/:id", (_req, res) =>
  res.json(view(res.locals.s, res.locals.p)),
);

app.post("/api/sessions/:id/draw", (_req, res) => {
  const s: Session = res.locals.s;
  if (res.locals.p.secret !== s.host)
    return res
      .status(403)
      .json({ error: "Bara värden kan starta lottningen." });
  if (s.matches)
    return res.status(409).json({ error: "Lottningen är redan klar." });
  s.matches = draw(s.people.map((p) => p.id));
  res.json(view(s, res.locals.p));
});

app.delete("/api/sessions/:id", (_req, res) => {
  if (res.locals.p.secret !== res.locals.s.host)
    return res
      .status(403)
      .json({ error: "Bara värden kan avsluta sessionen." });
  sessions.delete(res.locals.s.id);
  res.sendStatus(204);
});

app.use("/api", (_req, res) =>
  res.status(404).json({ error: "Sidan finns inte." }),
);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) =>
    res.status(400).json({
      error: err instanceof SyntaxError ? "Ogiltig förfrågan." : err.message,
    }),
);

export default app;
