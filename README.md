# Secret Santa

React + TypeScript, Express + TypeScript, Tailwind CSS 4 och DaisyUI 5 med temat winter.

## Köra lokalt

Node.js 22.18 eller senare behövs.

```sh
npm install
npm run dev
```

Öppna http://localhost:3000. Skapa en session med ditt namn, kopiera länken och bjud in deltagarna. Använd separata webbläsarprofiler eller separata enheter för att testa flera deltagare. Deltagarlistan uppdateras varannan sekund.

```sh
npm test
npm run build
npm start
```

`PORT` väljer port (standard 3000). Produktionsservern serverar både frontend och API. Memory-only local sessions require one process. Supabase-backed deployments can use Vercel Functions. Vid omstart försvinner alla sessioner. En lokal localhost-länk fungerar bara på den egna datorn; för delning krävs en nåbar serveradress.

## Deployment with Supabase and Vercel

Follow [SETUP.md](./SETUP.md) for database setup, environment variables, deployment and verification. Vercel always uses Supabase; local development without credentials can still use memory-only sessions.

Participants do not need accounts. Sessions last seven days and organizer deletion is immediate. Expired database records are cleaned up every ten minutes. Assignments are private API responses; the organizer has no access to other assignments. The database/server operator can technically access stored data. With two participants, each necessarily gets the other.
