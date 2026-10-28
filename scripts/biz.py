#!/usr/bin/env python3
"""Publish business needs/offerings and discover matches in local biz."""
import argparse
import json

from db import execute, literal as q


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    search = commands.add_parser('search')
    search.add_argument('query')
    search.add_argument('--limit', type=int, default=20)
    business = commands.add_parser('business-create')
    business.add_argument('name')
    business.add_argument('--slug', required=True)
    rep = commands.add_parser('representative-add')
    rep.add_argument('--business', type=int, required=True)
    rep.add_argument('--name', required=True)
    rep.add_argument('--email')
    rep.add_argument('--role', default='representative')
    listing = commands.add_parser('listing-create')
    listing.add_argument('--business', type=int, required=True)
    listing.add_argument('--representative', required=True)
    listing.add_argument('--direction', choices=['input', 'output'], required=True)
    listing.add_argument('--kind', choices=['product', 'service'], required=True)
    category = listing.add_mutually_exclusive_group(required=True)
    category.add_argument('--class-code')
    category.add_argument('--class-node-id', type=int)
    listing.add_argument('--title', required=True)
    listing.add_argument('--description')
    listing.add_argument('--quantity', type=str)
    listing.add_argument('--quantity-unit')
    listing.add_argument('--region', action='append', default=[])
    listing.add_argument('--available-from')
    listing.add_argument('--available-until')
    listing.add_argument('--attributes', default='{}', help='JSON object: required values for inputs, supplied values for outputs')
    for name in ['publish', 'withdraw', 'draft']:
        change = commands.add_parser(name)
        change.add_argument('listing_id')
        change.add_argument('--representative', required=True)
    listings = commands.add_parser('listings')
    listings.add_argument('--business', type=int, required=True)
    match = commands.add_parser('matches')
    match.add_argument('--business', type=int, required=True)
    match.add_argument('--direction', choices=['input', 'output'], default='input')
    match.add_argument('--distance', type=int, default=2)
    match.add_argument('--limit', type=int, default=50)
    args = parser.parse_args()

    if args.command == 'search':
        sql = f"SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]') FROM public.search_catalog({q(args.query)},{args.limit}) r;"
    elif args.command == 'business-create':
        sql = f"""WITH n AS (
          INSERT INTO public.ontology_node(slug,node_kind) VALUES ({q(args.slug)},'organization') RETURNING node_id
        ), b AS (
          INSERT INTO public.business(business_id,legal_name) SELECT node_id,{q(args.name)} FROM n RETURNING business_id
        ), names AS (
          INSERT INTO public.node_name(node_id,name,source) SELECT node_id,{q(args.name)},'human' FROM n
        ) SELECT to_jsonb(b) FROM b;"""
    elif args.command == 'representative-add':
        sql = f"""WITH i AS (
          INSERT INTO public.individual(display_name,email) VALUES ({q(args.name)},{q(args.email)}) RETURNING individual_id
        ), r AS (
          INSERT INTO public.business_representative(business_id,individual_id,role)
          SELECT {args.business},individual_id,{q(args.role)} FROM i RETURNING *
        ) SELECT to_jsonb(r) FROM r;"""
    elif args.command == 'listing-create':
        attributes = json.loads(args.attributes)
        if not isinstance(attributes, dict):
            parser.error('--attributes must be a JSON object')
        if bool(args.quantity) != bool(args.quantity_unit):
            parser.error('--quantity and --quantity-unit must be supplied together')
        class_id = str(args.class_node_id) if args.class_node_id else (
            f"(SELECT s.node_id FROM public.ontology_node_source s JOIN public.catalog_release r USING(release_id) "
            f"WHERE r.source='ECLASS' AND r.version='10.0.1' AND r.locale='us_en' AND s.code={q(args.class_code)})")
        regions = 'ARRAY[' + ','.join(q(r) for r in args.region) + ']::text[]'
        sql = f"""SELECT to_jsonb(r) FROM public.create_business_listing(
          {args.business},{q(args.representative)}::uuid,{q(args.direction)},{q(args.kind)},
          {class_id},{q(args.title)},{q(args.description)},{q(args.quantity)}::numeric,
          {q(args.quantity_unit)},{regions},{q(args.available_from)}::date,
          {q(args.available_until)}::date,{q(json.dumps(attributes))}::jsonb) r;"""
    elif args.command in ('publish', 'withdraw', 'draft'):
        state = {'publish': 'published', 'withdraw': 'withdrawn', 'draft': 'draft'}[args.command]
        sql = f"SELECT to_jsonb(r) FROM public.set_listing_state({q(args.listing_id)}::uuid,{q(args.representative)}::uuid,{q(state)}) r;"
    elif args.command == 'listings':
        sql = f"SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY created_at,listing_id),'[]') FROM public.business_listing r WHERE business_id={args.business};"
    else:
        sql = f"SELECT coalesce(jsonb_agg(to_jsonb(r)),'[]') FROM public.match_businesses({args.business},{q(args.direction)},{args.distance},{args.limit}) r;"
    try:
        print(json.dumps(execute(sql, json_result=True), indent=2, ensure_ascii=False))
    except RuntimeError as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
