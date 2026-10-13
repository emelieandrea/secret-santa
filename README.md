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

`PORT` väljer port (standard 3000). Produktionsservern serverar både frontend och API. Kör **en** kontinuerlig Node-process bakom HTTPS. Serverless och flera repliker passar inte den här minnesbaserade lösningen. Vid omstart försvinner alla sessioner. En lokal localhost-länk fungerar bara på den egna datorn; för delning krävs en nåbar serveradress.

## Sessioner och integritet

Ingen databas eller filbaserad sessionslagring används. Namn och tilldelningar hålls i serverns minne. Sessioner varar högst sex timmar. Värden kan avsluta en session och radera den tidigare. Högst 100 deltagare kan gå med. Nya deltagare blockeras efter lottning; omlottning är inte tillåten.

En kryptografiskt slumpad deltagarnyckel sparas i `sessionStorage` för att klara omladdning i samma flik. Inbjudningslänken innehåller ingen deltagarnyckel. Om fliken stängs kan åtkomst till tilldelningen gå förlorad. Låt därför fliken vara öppen tills alla är klara.

Servern använder kryptografisk Fisher–Yates-blandning och förkastar permutationer där någon får sig själv. Alla giltiga permutationer är lika sannolika. Varje person får exakt en unik mottagare. API-svaret innehåller bara den anropande deltagarens mottagare; värden har ingen specialåtkomst till andra tilldelningar. Två deltagare får ofrånkomligen varandra, och i små grupper går vissa tilldelningar att härleda. Serveroperatören har tekniskt åtkomst till processens minne; lösningen är inte end-to-end-krypterad.

Deltagarnycklar är privata åtkomstbevis. Dela bara inbjudningslänken. API-svar cachas inte och privata resultat loggas inte. Använd HTTPS vid publicering. Lägg ingen analys eller tredjepartsskript på resultatsidan.

DaisyUI-konfigurationen följer https://daisyui.com/docs/install/react/ och https://daisyui.com/docs/themes/.
