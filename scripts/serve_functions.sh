#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec deno run --allow-env --allow-net=127.0.0.1,localhost --allow-read supabase/functions/local.ts
