import express from "express";
import { fileURLToPath } from "node:url";

// Local development can still run without a database. Vercel never uses this fallback.
const configured = process.env.SUPABASE_URL || process.env.SUPABASE_SECRET_KEY;
const api = configured
  ? (await import("./app.ts")).default
  : (await import("./memory-app.ts")).default;
const app = express();
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return api(req, res, next);
  next();
});
const root = fileURLToPath(new URL("../", import.meta.url));
if (process.env.NODE_ENV === "production") {
  app.use(express.static(`${root}dist`));
  app.get("/{*path}", (_req, res) => res.sendFile(`${root}dist/index.html`));
} else {
  const { createServer } = await import("vite");
  const vite = await createServer({
    root,
    configLoader: "runner",
    server: { middlewareMode: true },
  });
  app.use(vite.middlewares);
}
app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(`Secret Santa: http://localhost:${process.env.PORT || 3000}`),
);
