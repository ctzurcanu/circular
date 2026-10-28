#!/usr/bin/env python3
"""Atomically and repeatably import ECLASS classes/keywords into local biz."""
import argparse
import csv
import hashlib
import json
from pathlib import Path
import re
import tempfile

from db import execute, literal


def read(path):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        return list(csv.DictReader(stream, delimiter=';'))


def checksum(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('directory', type=Path, nargs='?',
                        default=Path(__file__).resolve().parents[1] / 'data/1730100001enUSbasicCSV01')
    args = parser.parse_args()
    base = args.directory.resolve()
    ccfile = base / 'eClass10_0_1_CC_en.csv'
    kwfile = base / 'eClass10_0_1_KWSY_en.csv'
    classes, keywords = read(ccfile), read(kwfile)
    properties = {r['IrdiPR'] for r in read(base / 'eClass10_0_1_PR_en.csv')}
    codes = {r['CodedName'] for r in classes}
    identities = {r['IrdiCC'] for r in classes}
    if len(codes) != len(classes) or len(identities) != len(classes):
        raise ValueError('Duplicate class identity/code')
    normalized = []
    for r in classes:
        code, level = r['CodedName'], int(r['Level'])
        if not re.fullmatch(r'\d{8}', code) or level not in range(1, 5):
            raise ValueError('Invalid class code/level')
        parent = code[:2*(level-1)] + '00'*(5-level) if level > 1 else ''
        if parent and parent not in codes:
            raise ValueError(f'Missing parent for {code}')
        if r['ISOLanguageCode'] != 'en' or r['ISOCountryCode'] != 'US' or not r['PreferredName'].strip():
            raise ValueError('Missing English/US name')
        normalized.append([r['IrdiCC'], code, r['Identifier'], r['VersionNumber'],
                           r['RevisionNumber'], level, r['PreferredName'], r['Definition'],
                           parent, bool(re.search(r'\b(other|unspecified)\b', r['PreferredName'], re.I))])
    keyword_rows = []
    associations = set()
    for r in keywords:
        typ, target = r['TypeOfTargetSE'], r['IrdiTarget']
        if typ not in ('CC', 'PR') or target not in (identities if typ == 'CC' else properties):
            raise ValueError(f'Invalid keyword target: {target}')
        key = (typ, target, r['IrdiKW/IrdiSY'])
        if key in associations:
            raise ValueError('Duplicate keyword association')
        associations.add(key)
        keyword_rows.append([typ, target, r['IrdiKW/IrdiSY'], r['KeywordValue/SynonymValue'], r['Explanation']])

    with tempfile.TemporaryDirectory(prefix='biz-eclass-') as tmp:
        cpath, kpath = Path(tmp) / 'classes.csv', Path(tmp) / 'keywords.csv'
        for path, rows in ((cpath, normalized), (kpath, keyword_rows)):
            with path.open('w', encoding='utf-8', newline='') as stream:
                csv.writer(stream).writerows(rows)
        sql = rf"""
BEGIN;
SELECT pg_advisory_xact_lock(7310042);
CREATE TEMP TABLE stage_class (irdi text, code text, identifier text, version_number text,
  revision_number text, level smallint, name text, description text, parent_code text,
  is_unspecified boolean, node_id bigint) ON COMMIT DROP;
CREATE TEMP TABLE stage_keyword (target_type text, target_irdi text, irdi text, alias text, explanation text) ON COMMIT DROP;
\copy stage_class (irdi,code,identifier,version_number,revision_number,level,name,description,parent_code,is_unspecified) FROM {literal(cpath)} WITH (FORMAT csv)
\copy stage_keyword FROM {literal(kpath)} WITH (FORMAT csv)
CREATE UNIQUE INDEX ON stage_class(code);
CREATE UNIQUE INDEX ON stage_class(irdi);
ANALYZE stage_class;
ANALYZE stage_keyword;
DO $import$
DECLARE root bigint; existing public.catalog_release;
BEGIN
 SELECT * INTO existing FROM public.catalog_release WHERE source='ECLASS' AND version='10.0.1' AND locale='us_en';
 IF FOUND THEN
   IF existing.class_sha256 <> {literal(checksum(ccfile))} OR existing.keyword_sha256 <> {literal(checksum(kwfile))} THEN
     RAISE EXCEPTION 'Source files changed for an existing release';
   END IF;
 ELSE
   INSERT INTO public.ontology_node(slug,node_kind) VALUES ('eclass-10-0-1','root') RETURNING node_id INTO root;
   INSERT INTO public.node_name(node_id,name,source) VALUES (root,'ECLASS 10.0.1','imported');
   INSERT INTO public.catalog_release(source,version,root_node_id,class_sha256,keyword_sha256)
     VALUES ('ECLASS','10.0.1',root,{literal(checksum(ccfile))},{literal(checksum(kwfile))});
 END IF;
END;
$import$;
CREATE TEMP TABLE import_release ON COMMIT DROP AS
 SELECT * FROM public.catalog_release WHERE source='ECLASS' AND version='10.0.1' AND locale='us_en';
ANALYZE import_release;
UPDATE stage_class c SET node_id=s.node_id FROM public.ontology_node_source s JOIN import_release r USING(release_id)
  WHERE s.irdi=c.irdi;
UPDATE stage_class SET node_id=nextval(pg_get_serial_sequence('public.ontology_node','node_id')) WHERE node_id IS NULL;
INSERT INTO public.ontology_node(node_id,slug,node_kind) OVERRIDING SYSTEM VALUE
 SELECT c.node_id,'eclass-' || c.code,'topic' FROM stage_class c
 WHERE NOT EXISTS (SELECT 1 FROM public.ontology_node n WHERE n.node_id=c.node_id);
INSERT INTO public.ontology_node_source(release_id,irdi,node_id,code,identifier,version_number,revision_number,level,is_unspecified)
 SELECT r.release_id,c.irdi,c.node_id,c.code,c.identifier,c.version_number,c.revision_number,c.level,c.is_unspecified
 FROM stage_class c CROSS JOIN import_release r ON CONFLICT DO NOTHING;
INSERT INTO public.node_name(node_id,locale,name,description,source)
 SELECT node_id,'us_en',name,nullif(description,''),'imported' FROM stage_class ON CONFLICT DO NOTHING;
INSERT INTO public.ontology_edge(source_id,target_id,edge_type_id)
 SELECT coalesce(p.node_id,r.root_node_id),c.node_id,t.edge_type_id
 FROM stage_class c LEFT JOIN stage_class p ON p.code=c.parent_code
 CROSS JOIN import_release r CROSS JOIN public.edge_type t
 WHERE t.code='subtype' AND NOT EXISTS (SELECT 1 FROM public.ontology_edge e
   WHERE e.source_id=coalesce(p.node_id,r.root_node_id) AND e.target_id=c.node_id AND e.edge_type_id=t.edge_type_id)
 ORDER BY c.level,c.code;
INSERT INTO public.ontology_node_alias(release_id,irdi,node_id,locale,alias,explanation)
 SELECT r.release_id,k.irdi,c.node_id,'us_en',k.alias,nullif(k.explanation,'')
 FROM stage_keyword k JOIN stage_class c ON c.irdi=k.target_irdi CROSS JOIN import_release r
 WHERE k.target_type='CC' ON CONFLICT DO NOTHING;
INSERT INTO public.catalog_property_synonym(release_id,irdi,property_irdi,locale,synonym,explanation)
 SELECT r.release_id,k.irdi,k.target_irdi,'us_en',k.alias,nullif(k.explanation,'')
 FROM stage_keyword k CROSS JOIN import_release r WHERE k.target_type='PR' ON CONFLICT DO NOTHING;
DO $validate$
BEGIN
 IF EXISTS (SELECT 1 FROM public.ontology_collection c LEFT JOIN public.ontology_edge e
   ON e.source_id=c.parent_id AND e.target_id=c.other_node_id AND e.edge_type_id=c.edge_type_id
   LEFT JOIN public.node_name nn ON nn.node_id=c.other_node_id AND nn.locale='us_en'
   WHERE e.edge_id IS NULL OR nn.name IS DISTINCT FROM 'Other') THEN
   RAISE EXCEPTION 'Missing collection Other edge/name';
 END IF;
 IF (SELECT count(*) FROM public.ontology_node_source s JOIN import_release r USING(release_id)) <> {len(classes)}
   OR (SELECT count(*) FROM public.ontology_node_alias a JOIN import_release r USING(release_id)) <> {sum(r[0]=='CC' for r in keyword_rows)} THEN
   RAISE EXCEPTION 'Import counts differ from source';
 END IF;
END;
$validate$;
SELECT public.refresh_catalog_ancestor();
COMMIT;
SELECT jsonb_build_object('classes',(SELECT count(*) FROM public.ontology_node_source),
 'class_keywords',(SELECT count(*) FROM public.ontology_node_alias),
 'property_synonyms',(SELECT count(*) FROM public.catalog_property_synonym),
 'collections',(SELECT count(*) FROM public.ontology_collection),
 'ancestor_rows',(SELECT count(*) FROM public.catalog_ancestor));
"""
        output = execute(sql)
        print(output.splitlines()[-1])


if __name__ == '__main__':
    main()
