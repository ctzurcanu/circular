# biz website

A Next.js App Router application exported as static HTML/CSS/JS. It supports
catalog search and browsing, business registration, draft/edit/publish/withdraw
listings, supplier/buyer discovery, and private representative conversations.
All catalog labels and listings default to `us_en`. No Next.js server, API route,
or server action is required in production.

## Local development with the existing biz database

Requires Node.js 22+, npm, Deno 2, and local PostgreSQL on port 5432. Migrations
003 and 004 have already been applied in this workspace. For another database,
apply all migrations once and import the catalog before running the website.

From the repository root, run the development function server:

```sh
sh scripts/serve_functions.sh
```

It binds to `127.0.0.1:8787`, uses the current OS database user, and connects only
to a local database. Set `BIZ_DATABASE_URL` if your local PostgreSQL login differs.
It uses a development identity only through `functions/local.ts`. Hosted
`functions/biz-api/index.ts` never enables that identity bypass.

Then create `website/.env.development.local` (already present locally):

```dotenv
NEXT_PUBLIC_BIZ_API_URL=http://127.0.0.1:8787
NEXT_PUBLIC_LOCAL_MODE=true
```

```sh
cd website
npm ci
npm run dev
```

Open `http://127.0.0.1:3000`. Create your business workspace, then publish a need
or offer. Local development uses real `biz` data; your listings persist until
you edit or withdraw them. Test fixtures are removed by their test workflow.

## Static production build

Copy `.env.example` to `.env.production.local` and fill in the Supabase URL and
publishable key. These two values are public browser configuration. Never put
a database password or a service-role key into a `NEXT_PUBLIC_` variable.

```sh
npm run typecheck
npm run build
```

The deployable artifact is `website/out/`, including `.nojekyll`. For a GitHub
project site at `https://username.github.io/repository/`, set
`NEXT_PUBLIC_BASE_PATH=/repository` before building. Leave it empty for a root
Pages site or a custom domain. The config rejects production exports containing
the local identity flag or a loopback API endpoint. `.env.development.local` is
not used by production builds.

Without Supabase configuration the static page still builds and renders, but
shows a connection notice and disables publishing. It does not pretend to have
live business records.

## GitHub Pages deployment

The repository is `ctzurcanu/circular`, with Pages configured to use **GitHub
Actions**. The frontend is live at <https://ctzurcanu.github.io/circular/>.
Its repository variables are:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`

`.github/workflows/pages.yml` builds `website/out` and deploys it on main-branch
website changes or a manual workflow run. `actions/configure-pages` supplies the
correct repository base path, including custom-domain/root-site cases.

## Supabase database preparation

The existing local `auth.users` table is only a placeholder. A hosted deployment
must use Supabase's managed Auth schema. `scripts/prepare_supabase.py` generates
`supabase/bootstrap.sql` from the current schema/migrations, omitting that local
placeholder and expanding psql include directives:

```sh
python3 scripts/prepare_supabase.py
```

Apply that generated SQL only to a **fresh Supabase project** with no application
tables. For a project containing the original base schema, apply only the missing
numbered migrations in order after checking its existing schema. Migration 000
adapts the original hosted graph's parent/slug restrictions and English locale;
001 reuses existing relation types. Do not reapply migrations already installed.
Do not run the
full bootstrap over existing tables. The app migrations are not automatically
applied by function deployment.

Import classes/keywords into the target database using the importer transport
configuration described in the root README. The importer now accepts a target
database through standard `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`,
and `PGSSLMODE` environment variables; no remote credentials are embedded in code.

Migrations 003/004 enable row-level security and revoke browser-role access to
application tables and actor-parameter RPCs. Web access goes through the Edge
handler. Its private PostgreSQL connection must use an owner/BYPASSRLS backend
role (for example the project postgres login), not a browser account. Keep the
database URL in Supabase secrets.

## Supabase function deployment

The hosted entry point uses Supabase's managed `SUPABASE_DB_URL` by default.
Set `BIZ_DATABASE_URL` only to override it with another backend PostgreSQL or
session-pooler connection string. Set `ALLOWED_ORIGINS` to the exact frontend origin, such as
`https://username.github.io` (without `/repository`). Multiple origins may be
comma-separated. Keep connection credentials in an ignored env file based on
`supabase/functions/.env.example`:

```sh
supabase secrets set --env-file supabase/functions/.env.production --project-ref YOUR_PROJECT_REF
supabase functions deploy biz-api --project-ref YOUR_PROJECT_REF
```

Supabase supplies its Auth URL and public key to the hosted runtime. The handler
verifies protected requests using Auth's `getUser` endpoint and maps that user
to `individual.user_id`. It ignores caller-supplied actor/user IDs. Search and
catalog stats allow anonymous access; all business/listing/matching/chat actions
require verified identity and the appropriate membership. Platform `verify_jwt`
is disabled only so anonymous search can work; protected routes still verify
each user's token inside the function.

For deployment through GitHub, set secret `SUPABASE_ACCESS_TOKEN`, plus variables
`SUPABASE_PROJECT_REF` and `ALLOWED_ORIGINS`. `BIZ_DATABASE_URL` is an optional
secret override; omit it to use the managed database connection.
Run `.github/workflows/functions.yml` manually. It type-checks and deploys only
the hosted `biz-api` entry point, never the local development server.

Enable email sign-in in Supabase Auth. Add your full Pages URL (including the
repository path and trailing slash) to its allowed redirect URLs. The site uses
email links and persists its browser session; sign-out clears private views.

## Conversations

Start a conversation from a current match. Rooms and messages live only in the
browser's localStorage — nothing is written to the database or sent to the other
business, so treat them as private local notes. Sending a message requires an
explicit form submission. No external email, Slack, or SMS notifications are sent.

The Assistant view chats with Muse from Meta by default (your key stays in the
browser; another OpenAI-compatible endpoint can be set instead) to establish a
business's inputs and outputs. Describing the business offers matching catalog
categories as buttons; picking one opens the listing form with that category
preselected. Under Inputs, Proposed
inputs suggests needs derived from those chats; with too little conversation it
sends you back to chat more. A proposal can seed the listing form with one click.

## Verification

```sh
python3 tests/test_hosted_upgrade.py
cd website && npm run typecheck && npm run build
cd ..
deno task check
deno test --allow-env --allow-net=127.0.0.1,localhost --allow-read tests/edge_api_test.ts
```

The API test uses local PostgreSQL, disposable users/businesses, and cleans its
records in `finally`. It verifies unauthorized publishing, spoofed identities,
matching, private chat membership, invalid origins, bounded request bodies, and
that a single create request makes exactly one listing.

Reference: [Next.js static exports](https://nextjs.org/docs/app/guides/static-exports)
and [Supabase authenticated user verification](https://supabase.com/docs/reference/javascript/auth-getuser).

Category selection supports a ChatGPT/Claude handoff through the biz MCP server (see `../mcp/README.md` and `../.mcp.json.example`). Copy the prepared request, let your connected assistant compare catalog categories, and paste its numeric node ID to select a verified category. The website does not automatically configure an assistant connection.

Regions use a dropdown with expandable continent branches, country checkboxes, European Union, and Global. Global covers all regions, while empty means unspecified. Existing region selections are preserved during edits. “Available until” is optional; blank saves a null end date.

Apply `migrations/005_region_matching.sql` to existing databases for Global and collection/country matching.

Classification codes are kept internally. Listings, category search results, and catalog cards show **View in ECLASS** instead of the numeric code. It opens the official English ECLASS BASIC 16.0 item in a new tab using the site's supported POST form, avoiding invalid GET URLs with a missing/per-item `cHash`. Generated Other categories have no external ECLASS item link.

External ECLASS links show release 16.0, including its newer definitions and IRDIs. The local imported taxonomy remains 10.0.1, so external descriptions may reflect a newer revision of the same classification code.

## Taxonomy administration

Open `/admin/` (including your configured base path on GitHub Pages), or use **Taxonomy admin** in the workspace footer. Browse all graph roots; search names, codes or internal node IDs; follow outgoing/incoming links and filter by relation type. Results are paged in batches of 100 rather than rendering the whole catalog at once.

The expandable tree loads each branch on demand and groups outgoing links by relationship type. Use **+ Child** on a row to create a node attached through your chosen relation, or **+ Link** to search and connect an existing node. Saves refresh open branches without closing the tree. Repeated nodes in the current path stop expanding to avoid loops through semantic links.

Create a named semantic node, optionally attached to the selected node through a chosen relation. Connect existing nodes, or define a new relation type; hierarchy relations reject cycles. Database graph triggers generate a protected Other node for each `(source, relation type)` collection. Node labels/descriptions default to `us_en`. Organization concepts created here are taxonomy concepts; business workspaces still use the business creation flow.

Local development grants admin access only to the default local identity. Hosted requests require a verified Supabase session and an explicit row in `public.biz_admin`. Apply `migrations/006_taxonomy_admin.sql` to an existing database, then grant your authenticated account from a trusted database owner session:

```sql
INSERT INTO public.biz_admin(user_id) VALUES ('YOUR-SUPABASE-USER-UUID');
```

The browser cannot grant itself administrator access. The page exports statically; all privileged reads/writes go through the authenticated Edge API. New taxonomy data is persisted in PostgreSQL, not in the static export.
