# Supabase + Vercel setup

## 1. Supabase

1. Create a free project at https://supabase.com/dashboard. Choose a region near your participants and wait for the project to finish starting.
2. Open **SQL Editor → New query**. Paste all of `supabase/setup.sql` and run it. You should see `Success`. This creates the private session table, an atomic server-only operation, and cleanup every ten minutes. If the Cron extension step is unavailable, enable **pg_cron** in Database → Extensions and run the script again.
3. In the project's **Connect** dialog or **Settings → Data API**, copy the Project URL: `https://YOUR-PROJECT.supabase.co`.
4. Under **Settings → API Keys**, create/copy a **secret** key (`sb_secret_...`). The legacy **service_role** key also works. Do not use the publishable/anon key for this backend.

You do not need Supabase Auth, browser database access, or Realtime. There are deliberately no public RLS policies. SQL functions are executable only by the server role. The table stores hashes of participant access tokens; API responses reveal only the requesting person's recipient.

## 2. Vercel

Push the updated project including `api/`, `server/`, `tsconfig.server.json`, `vercel.json`, `supabase/`, `package.json`, and `package-lock.json` to your repository. Do not commit `.env`, credentials, `node_modules`, or `dist`.

In **Project → Settings → Environment Variables**, add:

| Name | Value | Environments |
| --- | --- | --- |
| `SUPABASE_URL` | Your Supabase Project URL | Production; Preview if you want previews to work |
| `SUPABASE_SECRET_KEY` | Your Supabase secret key | Production; Preview if needed |

These are server-only variables. **Never prefix the secret key with `VITE_` or put it in frontend code.** No Supabase variables are needed in React.

Remove any old `PUBLIC_ORIGIN` value if it refers to Render or another hostname. It is optional on Vercel: the backend validates the actual deployment origin, so preview URLs work too. If you explicitly set it, use the exact public origin without a path or trailing slash.

Under **Build and Deployment**, select **Vite**, build command `npm run build`, output directory `dist`, and install command `npm ci`. Use **Node.js 24.x** under the project's Node version settings. The committed `vercel.json` routes `/api/*` to the Node function and invitation URLs to React.

**Redeploy after adding the environment variables.** Updating them does not change an already built deployment. If dashboard rewrites or overrides were added while troubleshooting, remove conflicting ones so the repository configuration applies.

## 3. Verify

1. Open the new deployment and create a session.
2. Open the invitation in a different browser/private window and join.
3. Check both participant lists update. Only the organizer should see the draw button.
4. Draw names, then reveal a name in each window. No one should get themselves.
5. Refresh both pages; the session should still exist.
6. End the session as organizer. Both windows should lose access.

Sessions expire after six hours and are deleted by cleanup within roughly ten minutes while the database is active. Organizer deletion is immediate. This deletes active table records, not necessarily copies retained by the hosting provider's backups/logs. Free Supabase projects may pause after low activity; resume the project before a seasonal event.

## Local development

Without Supabase variables, `npm run dev` uses the original in-memory implementation. To exercise the Supabase API locally, create an ignored `.env` using `.env.example`, then run:

```sh
node --env-file=.env --experimental-strip-types server/index.ts
```

Do not set `PUBLIC_ORIGIN` to a deployed URL when testing at localhost. Use a separate Supabase project for isolated preview/test data if desired.

## Changes

The shared Supabase API runs in `server/app.ts`; `api/index.js` is the Vercel entrypoint. The build compiles the backend into `server-build/` using `tsconfig.server.json`, rewriting TypeScript import extensions to JavaScript. Vercel includes these generated files in its function; do not commit `server-build/`. Local serving stays in `server/index.ts`. Joins and draws lock one session row; drawing verifies that the participant list has not changed. Randomness still uses Node's cryptographic random generator. Supabase credentials and all assignments stay on the server.
