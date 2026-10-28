#!/usr/bin/env python3
"""Generate a fresh-project Supabase bootstrap without the local auth placeholder."""
from pathlib import Path

root = Path(__file__).resolve().parents[1]
schema = (root / 'schema.sql').read_text()
start = schema.index('CREATE SCHEMA auth;')
end = schema.index('CREATE TABLE public.locale', start)
schema = schema[:start] + '-- Uses Supabase-managed auth.users.\n' + schema[end:]
for line in schema.splitlines():
    if line.startswith('\\ir '):
        source = root / line.split(' ',1)[1]
        schema = schema.replace(line,source.read_text())
target = root / 'supabase/bootstrap.sql'
target.write_text('-- Fresh Supabase project only; do not apply over existing application tables.\nBEGIN;\n'+schema+'\nCOMMIT;\n')
print(target)
