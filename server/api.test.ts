import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';

test('session lifecycle, authorization and private API responses', async () => {
    const child = spawn(process.execPath, ['--experimental-strip-types', 'server/index.ts'], { env: { ...process.env, PORT: '3017' }, stdio: 'pipe' });
    try {
        let ready = false; for (let i = 0; i < 100; i++) { try { const res = await fetch('http://localhost:3017'); if (res.ok) { ready = true; break; } } catch { } await pause(100); } assert.ok(ready, 'server starts');
        const call = async (path: string, method = 'GET', secret?: string, body?: unknown) => { const res = await fetch(`http://localhost:3017/api/sessions${path}`, { method, headers: { 'Content-Type': 'application/json', ...(secret ? { Authorization: `Bearer ${secret}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: res.status, data: res.status === 204 ? null : await res.json() }; };
        const a = await call('', 'POST', undefined, { name: 'Anna' }); assert.equal(a.status, 201); const path = `/${a.data.id}`;
        assert.equal((await call(path + '/draw', 'POST', a.data.secret)).status, 400);
        const b = await call(path + '/join', 'POST', undefined, { name: 'Bo' }); const c = await call(path + '/join', 'POST', undefined, { name: 'Cia' });
        assert.equal((await call(path)).status, 401); assert.equal((await call(path + '/draw', 'POST', b.data.secret)).status, 403);
        assert.equal((await call(path + '/join', 'POST', undefined, { name: ' anna ' })).status, 409);
        assert.equal((await call(path + '/draw', 'POST', a.data.secret)).status, 200);
        const recipients = []; for (const p of [a, b, c]) { const v = await call(path, 'GET', p.data.secret); assert.equal(v.status, 200); assert.notEqual(v.data.recipient, p.data.people.find((x: { id: string }) => x.id === p.data.me).name); assert.ok(!('matches' in v.data)); assert.ok(v.data.people.every((x: object) => !('secret' in x))); recipients.push(v.data.recipient); } assert.equal(new Set(recipients).size, 3);
        assert.equal((await call(path + '/draw', 'POST', a.data.secret)).status, 409); assert.equal((await call(path + '/join', 'POST', undefined, { name: 'Dan' })).status, 409);
        assert.equal((await call(path, 'DELETE', b.data.secret)).status, 403); assert.equal((await call(path, 'DELETE', a.data.secret)).status, 204); assert.equal((await call(path, 'GET', a.data.secret)).status, 404);
    } finally { child.kill(); }
});
