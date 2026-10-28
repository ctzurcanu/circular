import { createHandler } from '../_shared/handler.ts';
const databaseUrl = Deno.env.get('BIZ_DATABASE_URL');
if (!databaseUrl) throw new Error('BIZ_DATABASE_URL is required.');
const app = createHandler({databaseUrl,
  allowedOrigins: (Deno.env.get('ALLOWED_ORIGINS') || '').split(',').map(x => x.trim()).filter(Boolean),
  supabaseUrl: Deno.env.get('SUPABASE_URL'),
  publishableKey: Deno.env.get('SUPABASE_ANON_KEY') || Deno.env.get('SUPABASE_PUBLISHABLE_KEY'),
});
Deno.serve(app.handler);
