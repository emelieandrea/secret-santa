import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";

test("Supabase API hashes tokens, handles concurrency errors and hides database failures", async () => {
  const requests: Record<string, any>[] = [];
  let response: any = {
    id: "room",
    people: [
      { id: "alice", name: "Alice" },
      { id: "bob", name: "Bob" },
    ],
    me: "alice",
    isHost: true,
    drawn: false,
    recipient: null,
    expires: Date.now() + 1000,
  };
  let failure = false;
  const db = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    requests.push(JSON.parse(text));
    assert.equal(req.url, "/rest/v1/rpc/santa_action");
    res.writeHead(failure ? 500 : 200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        failure ? { message: "private internal database error" } : response,
      ),
    );
  });
  db.listen(0, "127.0.0.1");
  await once(db, "listening");
  const dbPort = (db.address() as { port: number }).port;
  process.env.SUPABASE_URL = `http://127.0.0.1:${dbPort}`;
  process.env.SUPABASE_SECRET_KEY = "server-only-test-key";
  const app = (await import("./app.ts")).default;
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const call = async (path: string, method: string, body?: object) =>
    fetch(origin + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer private-participant-token",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  try {
    const joined = await call("/api/sessions/room/join", "POST", {
      name: "Alice",
    });
    assert.equal(joined.status, 201);
    const data = await joined.json();
    assert.ok(data.secret);
    assert.notEqual(requests[0].secret_hash, data.secret);
    assert.match(requests[0].secret_hash, /^[a-f0-9]{64}$/);
    assert.ok(!JSON.stringify(data).includes("server-only-test-key"));
    // Read is used to compute a cryptographic derangement; SQL handles the atomic commit.
    response = { status: 409, error: "En deltagare gick precis med." };
    const conflict = await call("/api/sessions/room/draw", "POST");
    assert.equal(conflict.status, 409);
    failure = true;
    const failed = await call("/api/sessions/room", "GET");
    assert.equal(failed.status, 503);
    assert.ok(!(await failed.text()).includes("private internal"));
    assert.equal((await call("/api/sessions/room", "PATCH")).status, 405);
  } finally {
    server.close();
    db.close();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SECRET_KEY;
  }
});
