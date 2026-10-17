import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { setTimeout as pause } from "node:timers/promises";

test("session lifecycle, authorization and private API responses", async () => {
  const child = spawn(
    process.execPath,
    ["--experimental-strip-types", "server/index.ts"],
    {
      env: {
        ...process.env,
        PORT: "3017",
        PUBLIC_ORIGIN: "https://santa.example.com",
      },
      stdio: "pipe",
    },
  );
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      try {
        const res = await fetch("http://localhost:3017");
        if (res.ok) {
          ready = true;
          break;
        }
      } catch {}
      await pause(100);
    }
    assert.ok(ready, "server starts");
    const call = async (
      path: string,
      method = "GET",
      secret?: string,
      body?: unknown,
    ) => {
      const res = await fetch(`http://localhost:3017/api/sessions${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          Origin: "https://santa.example.com",
          ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      return {
        status: res.status,
        data: res.status === 204 ? null : await res.json(),
      };
    };
    const blocked = await fetch("http://localhost:3017/api/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://other.example.com",
      },
      body: JSON.stringify({ name: "Uninvited origin", pin: "0123" }),
    });
    assert.equal(blocked.status, 403);
    const a = await call("", "POST", undefined, { name: "Anna", pin: "0123" });
    assert.equal(a.status, 201);
    const path = `/${a.data.id}`;
    assert.equal(
      (await call(path + "/draw", "POST", a.data.secret)).status,
      400,
    );
    const lobbyResponse = await fetch(
      `http://localhost:3017/api/sessions/${a.data.id}/lobby`,
    );
    const lobby = await lobbyResponse.json();
    assert.equal(lobby.people[0].name, "Anna");
    assert.ok(!("recipient" in lobby));
    assert.ok(!JSON.stringify(lobby).includes(a.data.secret));
    assert.equal(
      (
        await call(path + "/resume", "POST", undefined, {
          participantId: a.data.me,
          pin: "9999",
        })
      ).status,
      401,
    );
    const recovered = await call(path + "/resume", "POST", undefined, {
      participantId: a.data.me,
      pin: "0123",
    });
    assert.equal(recovered.status, 200);
    assert.equal(recovered.data.isHost, true);
    assert.equal((await call(path, "GET", a.data.secret)).status, 401);
    a.data.secret = recovered.data.secret;
    assert.ok(recovered.data.expires > Date.now() + 6 * 24 * 60 * 60 * 1000);
    const b = await call(path + "/join", "POST", undefined, {
      name: "Bo",
      pin: "0123",
    });
    const c = await call(path + "/join", "POST", undefined, {
      name: "Cia",
      pin: "0123",
    });
    assert.equal((await call(path)).status, 401);
    assert.equal(
      (await call(path + "/draw", "POST", b.data.secret)).status,
      403,
    );
    assert.equal(
      (
        await call(path + "/join", "POST", undefined, {
          name: " anna ",
          pin: "0123",
        })
      ).status,
      409,
    );
    assert.equal(
      (await call(path + "/draw", "POST", a.data.secret)).status,
      200,
    );
    const recipients = [];
    for (const p of [a, b, c]) {
      const v = await call(path, "GET", p.data.secret);
      assert.equal(v.status, 200);
      assert.notEqual(
        v.data.recipient,
        p.data.people.find((x: { id: string }) => x.id === p.data.me).name,
      );
      assert.ok(!("matches" in v.data));
      assert.ok(v.data.people.every((x: object) => !("secret" in x)));
      recipients.push(v.data.recipient);
    }
    assert.equal(new Set(recipients).size, 3);
    assert.equal(
      (await call(path + "/draw", "POST", a.data.secret)).status,
      409,
    );
    assert.equal(
      (
        await call(path + "/join", "POST", undefined, {
          name: "Dan",
          pin: "0123",
        })
      ).status,
      409,
    );
    const resumedGuest = await call(path + "/resume", "POST", undefined, {participantId:b.data.me,pin:"0123"});
    assert.equal(resumedGuest.status,200);
    assert.equal(resumedGuest.data.recipient,recipients[1]);
    assert.equal(resumedGuest.data.isHost,false);
    b.data.secret=resumedGuest.data.secret;
    for(let attempt=1;attempt<=5;attempt++) {
      assert.equal((await call(path+"/resume","POST",undefined,{participantId:c.data.me,pin:"9999"})).status,attempt===5?429:401);
    }
    assert.equal((await call(path+"/resume","POST",undefined,{participantId:c.data.me,pin:"0123"})).status,429);
    assert.equal((await call(path, "DELETE", b.data.secret)).status, 403);
    assert.equal((await call(path, "DELETE", a.data.secret)).status, 204);
    assert.equal((await call(path, "GET", a.data.secret)).status, 404);
  } finally {
    child.kill();
  }
});
