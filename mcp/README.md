# biz MCP server

A stdio MCP server for the same catalog, business publishing, matching, and
representative conversations used by the website. It uses the official TypeScript
SDK and the shared Edge API handler. Default locale stays `us_en`; removing the
locale text from the UI does not change stored data or defaults.

## Local use

Requires Deno 2 and the existing PostgreSQL `biz` database on localhost:5432.
The server runs directly against that database; no separate HTTP function server
is needed. Run from the project root:

```sh
deno task mcp
```

This exposes catalog tools. For business tools, set the local user identity:

```sh
BIZ_MCP_USER_ID=00000000-0000-4000-8000-000000000001 deno task mcp
```

That UUID is the local website development identity, so records created through
the MCP server and local website belong to the same workspace. It is a trusted
local administrator identity, not an authentication token. Supply a different
`BIZ_MCP_USER_ID` to use another local identity. `BIZ_DATABASE_URL` may override
the local connection; direct mode refuses remote database hosts.

The process communicates over stdin/stdout and waits for a client. All tool
errors are MCP error results; stdout is reserved for JSON-RPC, not status logs.
To register in a compatible client, use the project-root `.mcp.json.example`.
The example has an absolute entry-point path for this machine. Update it if
you move the project. No global client settings have been changed automatically.

## Hosted Supabase access

Set these variables in the MCP client's server environment:

- `BIZ_MCP_API_URL`: full HTTPS endpoint, e.g. `https://PROJECT.supabase.co/functions/v1/biz-api`.
- `BIZ_MCP_ACCESS_TOKEN`: the signed-in Supabase user's access token.
- `BIZ_MCP_PUBLISHABLE_KEY`: the project's public key when needed by the gateway.

Launch with `deno run --config /absolute/path/deno.json --allow-env --allow-read --allow-net /absolute/path/mcp/server.ts`
so it can reach the configured HTTPS endpoint. Hosted mode never uses
`BIZ_MCP_USER_ID` as authentication; the Edge handler verifies the user token and
derives representative membership. Expired tokens must be refreshed by your
sign-in/client flow and the server restarted with the new token. Do not commit
tokens, passwords, or service-role keys into configuration files.

## Tools

| Tool | Purpose |
| --- | --- |
| `catalog_stats` | Imported class/keyword counts |
| `search_catalog` | Search names, keywords, and ECLASS codes |
| `browse_catalog` | Child categories and the collection’s Other node |
| `get_catalog_category` | Verify a published category node ID |
| `list_businesses` | Businesses represented by the configured identity |
| `create_business` | Create a business and its representative workspace |
| `list_listings` | Your business's drafts, published, and withdrawn listings |
| `create_listing_draft` | Draft an input/need or output/offer |
| `edit_listing_draft` | Replace listing fields and return it to draft |
| `publish_listing` | Make a listing discoverable |
| `withdraw_listing` | Remove a listing from discovery without deletion |
| `match_businesses` | Find suppliers or buyers and explain candidate fit |
| `start_conversation` | Create/reuse a room for a current match; sends no message |
| `list_conversations` | Your private conversations |
| `read_messages` | Most recent messages in a member conversation |
| `send_message` | Explicitly send a message to conversation members |

`biz://guide` is a resource describing the workflow and matching semantics.
Tools include read/write, idempotency, destructive-operation, and messaging hints.
The server instructions require explicit user requests for publishing, withdrawal,
and sending messages. Client policies still govern tool approval; annotations
are descriptive hints, not a replacement for authentication or user authorization.

Edits replace the full listing fields, so first read the existing listing and
preserve any optional details you want to retain. A quantity requires a unit.
Other is collection-specific and never acts as a wildcard. Matches identify
category compatibility, broader claims, alternatives, and missing requirements;
they do not establish technical equivalence.

## Verification

```sh
deno task check
deno test --allow-env --allow-read --allow-net=127.0.0.1,localhost --allow-run tests/mcp_test.ts
```

The integration test launches a real stdio MCP process, initializes a client,
lists tools/resources, exercises catalog and draft/publish/withdraw operations,
and cleans its disposable records. It also checks read-only operation without
a configured identity.

SDK reference: [official MCP TypeScript server documentation](https://ts.sdk.modelcontextprotocol.io/server).

### AI category decisions for the site

The listing form’s **Choose with AI** handoff prepares a request for ChatGPT or Claude. Connect this server in your chosen MCP client, copy the request from the site, and return the assistant’s numeric category node ID. The site verifies that ID against the published catalog before selecting it. Opening the assistant does not automatically connect MCP or transfer a draft.

The `choose_category` MCP prompt guides a decision using multiple searches, child-category comparisons, clarifying questions, and `get_catalog_category` verification. An assistant should explain its choice and uncertainty; only the user chooses whether to publish. No model key is embedded in the static site.

Region codes include `GLOBAL`, continent collections (`AFRICA`, `ASIA`, `EUROPE`, `N_AMERICA`, `S_AMERICA`, `OCEANIA`, `ANTARCTICA`), `EU`, and country codes. Global covers all regions; collections match their constituent countries. Empty coverage remains unknown. `available_until` is optional; omit it for an open-ended listing.
