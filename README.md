# circular

## Model

`ontology_node` is the shared graph identity. `business` extends an `organization`
node; `product_service` extends a `product` or `service` node. Insert the node
first, then its typed record. Use `node_name` for localized labels and descriptions.
Product/service records can describe categories or concrete offerings, distinguished
by `is_category`.

`individual` holds people independently of login accounts, with an optional local
`auth.users` link. Its display name and GitHub/X handles follow the profile pattern
in the neighboring `ensemble` project. No remote ensemble accounts have been copied
or linked automatically. `business_representative` connects a person to any number
of businesses and a business to any number of people, with their role and at most
one primary representative per business.

`business_input` records products/services a business needs or consumes;
`business_output` records what it provides. These may reference a category when
only that level of detail is known. `business_catalog` returns each business with
its inputs, outputs, and representatives as JSON arrays using `us_en` labels.

## Semantic graph and Other

Edges point from **parent to child**. The seeded relation types are `subtype`,
`part`, and `related`. Add other types through `edge_type`; mark a relation
`is_hierarchy` when it must be acyclic. Cycles are rejected within each hierarchy
relation; different relations express different graphs. Multiple parents are
allowed. Use edges rather than the legacy `ontology_node.parent_id` field.

A collection is a `(parent_id, edge_type_id)` pair in `ontology_collection`.
Creating a collection automatically creates its dedicated `Other` node, the
`us_en` label, and the edge from its parent. Inserting the first edge from an
ordinary node also creates the collection. Even nonhierarchy collections receive
an Other bucket. A node with no outgoing relations is a leaf and has no collection.
Create an empty collection explicitly if its Other bucket is needed before any
other children are known:

```sql
INSERT INTO ontology_collection (parent_id, edge_type_id)
SELECT :parent_id, edge_type_id FROM edge_type WHERE code = 'subtype';
```

Every collection has exactly one generated Other bucket. It is scoped to its
parent and relation: the same parent's `subtype` and `part` collections have
different buckets. Collection identities and mandatory Other edges are protected
from update/deletion. If a leaf fits none of the named children, link it beneath
the collection's Other node using the same relation. Other buckets do not generate
further Other buckets. Classification into Other requires an explicit decision;
the database cannot infer whether a leaf semantically fits a named category.

`Products` and `Services` root categories are seeded, each with an Other child
under the `subtype` relation. Slugs are not globally unique; resolve Other nodes
through `ontology_collection.other_node_id`, not by the slug `other`.

## Setup and validation

For a new empty database, `schema.sql` includes the graph migration:

```sh
psql -X -h localhost -p 5432 -d biz -v ON_ERROR_STOP=1 --single-transaction -f schema.sql
```

For a database already initialized with the original schema, apply
`migrations/001_business_graph.sql` once with the same flags. It has already been
applied to the local `biz` database. Run the rollback-only integration checks with:

```sh
psql -X -h localhost -p 5432 -d biz -v ON_ERROR_STOP=1 -f tests/business_graph.sql
```

The local `auth.users` table is an ID placeholder, not a Supabase authentication
implementation. This setup is a local data model; access policies and a remote
Supabase deployment are outside the current implementation.

## Imported catalog

41,647 classification nodes, 54,992 class-keyword associations, 
and 505 property synonyms preserved separately for
later property ingestion. Source classifications are neutral `topic` nodes:
business listings explicitly choose `product` or `service`. No companies or
representatives are manufactured from this classification data.

The importer preserves source/version/IRDI/code identities and SHA-256 checksums.
Each parent/relation collection has a generated `Other` child with a protected
`us_en` label. Source Other/unspecified classes retain their original identities.
There are 6,025 collections in the current database: 6,023 and two
existing Products/Services collections. Leaves do not create additional collections.

Rerunning the importer is safe: the same files reuse nodes and keywords, while
changed files for an already imported release are rejected. The complete import
is transactional. Graph editing, importing, and matching-cache refresh use the
same lock order. Ancestor data refreshes automatically when matching runs after
graph changes; direct reads of `catalog_ancestor` should first call
`refresh_catalog_ancestor()`.

```sh
python3 scripts/import_eclass.py
python3 scripts/biz.py search 'software development'
python3 scripts/biz.py search 13030204
```

Generated Other search results include their parent ID, code, and name so that
similarly named buckets can be distinguished. Use `--class-node-id` to publish
against one of these buckets, or `--class-code` for an ECLASS source class.

## Publish inputs and outputs

The CLI requires Python 3 and the installed `psql`; it defaults to `localhost:5432`
and database `biz`. Standard `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`,
and `PGSSLMODE` environment variables can explicitly select another database.
It never reads the remote Supabase credentials from `.env`.

```sh
python3 scripts/biz.py business-create 'Your company' --slug your-company
python3 scripts/biz.py representative-add --business BUSINESS_ID --name 'Your name'
```

Replace `BUSINESS_ID`, `REPRESENTATIVE_ID`, and `LISTING_ID` below with the IDs
printed by the respective creation commands. Creating a listing creates a draft;
only publishing makes it discoverable.

```sh
python3 scripts/biz.py listing-create --business BUSINESS_ID \
  --representative REPRESENTATIVE_ID --direction input --kind service \
  --class-code 13030204 --title 'Need Python software development' \
  --quantity 100 --quantity-unit hour --region FR \
  --attributes '{"language":"python"}'
python3 scripts/biz.py publish LISTING_ID --representative REPRESENTATIVE_ID
python3 scripts/biz.py listings --business BUSINESS_ID
```

For a supplier, create a listing with `--direction output`, the supplied quantity,
delivery regions, and attributes. Multiple listings under the same class are
supported. `--available-from` and `--available-until` accept ISO dates; optional
`--description` provides free text. Inputs' attributes are required values;
outputs' attributes are supplied values. Attribute comparisons use exact JSON
values, not inferred synonyms or unit conversions. Regions are sets of acceptable
buyer locations and seller delivery locations; at least one shared region is
needed when both are supplied.

```sh
python3 scripts/biz.py withdraw LISTING_ID --representative REPRESENTATIVE_ID
python3 scripts/biz.py draft LISTING_ID --representative REPRESENTATIVE_ID
```

`create_business_listing()` and `set_listing_state()` check that the actor is a
representative of the business. The contact has a composite foreign key to that
business's representatives. This CLI is a trusted local administrator tool:
the actor argument is not authentication. A future public web/API deployment must
derive that actor from authenticated identity and enforce database/API permissions;
do not expose these operations with an arbitrary caller-supplied actor ID.

`published_business_catalog` returns currently published, unexpired inputs/outputs
and the representatives of active businesses. The original `business_catalog`
view and `business_input`/`business_output` tables remain the earlier category-link
model; new publication and discovery use `business_listing` instead.

## Match businesses

```sh
python3 scripts/biz.py matches --business BUSINESS_ID
python3 scripts/biz.py matches --business BUSINESS_ID --direction output
python3 scripts/biz.py matches --business BUSINESS_ID --distance 2 --limit 50
```

Input discovery finds suppliers; output discovery finds buyers. The result
contains both business/listing IDs, both contact representatives, the category
relationship, taxonomy distance, ranking score, and unknown requirements.
Each listing points directly to one classification; an input/output posting is
the actual need/offer, not another taxonomy node.

Matching excludes the same business, drafts, withdrawn/expired listings,
archived businesses/categories, different product/service kinds, conflicting
known attributes, insufficient quantities in the same unit, disjoint known
regions, and nonoverlapping known availability windows. Missing seller information
remains an explicit unknown. Different quantity units require conversion and are
flagged rather than compared as if equivalent.

Matches are labeled `same_class`, `specific_offer`, `broad_offer`,
`nearby_alternative`, or `unclassified`. Broad claims and nearby siblings need
clarification. Near candidates require a shared ECLASS ancestor at level 2 or
deeper and a configurable bounded distance (default 2, maximum 6); sharing the
universal taxonomy root alone is not a match. Other/unspecified classes never
expand as wildcards: only the same bucket/class can be an unclassified candidate.
Text detection of source labels containing whole words Other/unspecified is
deliberately conservative and is stored separately from generated Other identity.

A `category_match` assessment describes category compatibility and the supplied
constraints; it does not claim full technical equivalence. Ranking scores are
explainable heuristics, not probabilities. Property dictionaries, numerical property
ranges and verified unit conversions remain later steps. No messages are sent by
discovery; the website now implements private representative chat after an explicit
conversation/message action.

Migration `002_catalog_and_listings.sql` has been applied locally and is included
in fresh `schema.sql` bootstraps. Verification uses rollback-only fixtures:

```sh
psql -X -h localhost -p 5432 -d biz -v ON_ERROR_STOP=1 -f tests/business_graph.sql
psql -X -h localhost -p 5432 -d biz -v ON_ERROR_STOP=1 -f tests/catalog_and_listings.sql
python3 tests/test_cli.py
```

## Next.js website and Supabase functions

The static Next.js site in `website/` supports business setup, catalog browsing,
publishing/editing listings, supplier/buyer matching, and representative chat.
Its build exports `website/out/` for GitHub Pages. Server operations live in
`supabase/functions/biz-api/`; no Next.js server is required in production.
Migrations 003/004 add the web access boundary and private conversations and are
applied locally. See [website setup and deployment](website/README.md) for local
preview, GitHub Pages workflows, Supabase preparation, function secrets, and Auth
redirect settings. No remote deployment has been performed in this workspace.

## MCP server

`mcp/server.ts` exposes catalog search/browsing, business workspaces, drafts,
publication/withdrawal, matching, and private representative conversations over
stdio. Run `deno task mcp` for catalog access, or set `BIZ_MCP_USER_ID` for local
business operations. It reuses the site's authorization and business logic.
See [MCP setup and tools](mcp/README.md) and `.mcp.json.example` for client
configuration and optional authenticated hosted Supabase access.
