#!/usr/bin/env python3
"""Fill missing us_en class descriptions from eclass.eu item pages.

Polite by design: identifiable User-Agent, bounded concurrency, delay between
requests, retries with backoff. Only fills NULL descriptions on ECLASS source
nodes and stamps source='eclass.eu-16.0' (local taxonomy is 10.0.1, so wording
may reflect the newer release). Rerunning is safe: completed codes are skipped
because their descriptions are no longer NULL.

Usage:
    python3 scripts/collect_eclass_definitions.py --limit 20
    python3 scripts/collect_eclass_definitions.py --workers 6
"""
import argparse
import html
import json
import re
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

from db import execute, literal

URL = 'https://eclass.eu/en/eclass-standard/search-content/show'
UA = 'biz-definition-collector/1.0 (+local taxonomy enrichment)'
BLOB = re.compile(r'\{[^{}]*?&quot;definition&quot;.*?\}')


def fetch_definition(code, timeout=30, pacing=1.0):
    fields = {'tx_eclasssearch_ecsearch[discharge]': '0',
              'tx_eclasssearch_ecsearch[id]': code,
              'tx_eclasssearch_ecsearch[language]': '1',
              'tx_eclasssearch_ecsearch[version]': '16.0'}
    data = urllib.parse.urlencode(fields).encode()
    last = None
    try:
        for attempt in range(3):
            try:
                req = urllib.request.Request(URL, data=data, headers={'User-Agent': UA})
                with urllib.request.urlopen(req, timeout=timeout) as response:
                    raw = response.read().decode('utf-8', errors='replace')
                for blob in BLOB.findall(raw):
                    try:
                        entry = json.loads(html.unescape(blob))
                    except ValueError:
                        continue
                    if str(entry.get('id')) == code and (entry.get('definition') or '').strip():
                        return entry['definition'].strip()
                return None
            except Exception as exc:  # noqa: BLE001 - retry then record failure
                last = exc
                time.sleep(2 * (attempt + 1))
    finally:
        time.sleep(pacing)
    print(f'skip {code}: {last}', flush=True)
    return None


def pending_codes(limit):
    sql = ("SELECT s.code FROM ontology_node_source s "
           "JOIN node_name n ON n.node_id=s.node_id AND n.locale='us_en' "
           "WHERE nullif(btrim(n.description),'') IS NULL ORDER BY s.code")
    if limit:
        sql += f' LIMIT {int(limit)}'
    return execute(sql).splitlines()


def store(code, definition):
    execute('UPDATE node_name n SET description=' + literal(definition) +
            ", source='eclass.eu-16.0' FROM ontology_node_source s " +
            "WHERE s.node_id=n.node_id AND n.locale='us_en' " +
            "AND nullif(btrim(n.description),'') IS NULL AND s.code=" + literal(code))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--limit', type=int, default=0)
    parser.add_argument('--workers', type=int, default=3)
    parser.add_argument('--delay', type=float, default=1.0)
    args = parser.parse_args()
    codes = [c for c in pending_codes(args.limit) if c]
    print(f'{len(codes)} codes without a description', flush=True)
    done = filled = 0
    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {pool.submit(fetch_definition, code, 30, args.delay): code for code in codes}
        for future in as_completed(futures):
            code = futures[future]
            definition = future.result()
            done += 1
            if definition:
                store(code, definition)
                filled += 1
            if done % 25 == 0 or done == len(codes):
                print(f'{done}/{len(codes)} fetched, {filled} filled', flush=True)
    print(f'done: {done} fetched, {filled} filled', flush=True)


if __name__ == '__main__':
    main()
