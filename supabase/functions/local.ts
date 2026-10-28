// Development-only entry point; never deployed by `supabase functions deploy`.
import { createHandler } from './_shared/handler.ts';
const databaseUrl = Deno.env.get('BIZ_DATABASE_URL') || `postgresql://${Deno.env.get('USER')}@localhost:5432/biz`;
if (!['localhost','127.0.0.1','::1'].includes(new URL(databaseUrl).hostname)) throw new Error('Local development requires a local database.');
const app = createHandler({databaseUrl, allowedOrigins:['http://127.0.0.1:3000','http://localhost:3000','http://127.0.0.1:4173'],
  localUser:Deno.env.get('BIZ_LOCAL_DEV_USER') || '00000000-0000-4000-8000-000000000001'});
Deno.serve({hostname:'127.0.0.1',port:8787},app.handler);
