"""Exercise real CLI SQL against biz, rolling back every fixture and command."""
import contextlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
import biz
import db

ACTOR = '00000000-0000-0000-0000-000000009101'
OTHER = '00000000-0000-0000-0000-000000009102'
LISTING = '00000000-0000-0000-0000-000000009103'
FIXTURE = f"""
INSERT INTO ontology_node(node_id,slug,node_kind) OVERRIDING SYSTEM VALUE
  VALUES (-91001,'test-cli-buyer','organization'),(-91002,'test-cli-seller','organization');
INSERT INTO business(business_id) VALUES (-91001),(-91002);
INSERT INTO individual(individual_id,display_name) VALUES ('{ACTOR}','Buyer'),('{OTHER}','Seller');
INSERT INTO business_representative(business_id,individual_id) VALUES (-91001,'{ACTOR}'),(-91002,'{OTHER}');
INSERT INTO business_listing(listing_id,business_id,direction,kind,class_node_id,title,contact_individual_id)
 SELECT '{LISTING}',-91001,'input','service',node_id,'CLI test need','{ACTOR}'
 FROM ontology_node_source WHERE code='13030204';
"""


class CliTest(unittest.TestCase):
    def run_cli(self, *arguments, extra=''):
        def transactional(sql, json_result=False):
            return db.execute('BEGIN;\n' + FIXTURE + extra + sql + '\nROLLBACK;', json_result)
        output = io.StringIO()
        with patch.object(sys, 'argv', ['biz.py', *arguments]), patch.object(biz, 'execute', transactional), contextlib.redirect_stdout(output):
            biz.main()
        return json.loads(output.getvalue())

    def test_business_creation_and_quoting(self):
        result = self.run_cli('business-create', "Company's SQL test", '--slug', 'cli-created-business')
        self.assertIsInstance(result['business_id'], int)

    def test_representative_creation(self):
        result = self.run_cli('representative-add', '--business', '-91001', '--name', "Rep's name")
        self.assertEqual(result['business_id'], -91001)

    def test_draft_creation(self):
        result = self.run_cli('listing-create', '--business', '-91001', '--representative', ACTOR,
                              '--direction', 'output', '--kind', 'service', '--class-code', '13030204',
                              '--title', "Python's service", '--region', 'fr', '--quantity', '100',
                              '--quantity-unit', 'HOUR', '--attributes', '{"language":"python"}')
        self.assertEqual(result['state'], 'draft')
        self.assertEqual(result['locale'], 'us_en')
        self.assertEqual(result['regions'], ['FR'])
        self.assertEqual(result['quantity_unit'], 'hour')

    def test_publish(self):
        result = self.run_cli('publish', LISTING, '--representative', ACTOR)
        self.assertEqual(result['state'], 'published')

    def test_withdraw(self):
        result = self.run_cli('withdraw', LISTING, '--representative', ACTOR)
        self.assertEqual(result['state'], 'withdrawn')

    def test_listings(self):
        result = self.run_cli('listings', '--business', '-91001')
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['listing_id'], LISTING)

    def test_matches(self):
        extra = f"""
UPDATE business_listing SET state='published' WHERE listing_id='{LISTING}';
INSERT INTO business_listing(business_id,direction,kind,class_node_id,title,contact_individual_id,state)
 SELECT -91002,'output','service',node_id,'CLI test offer','{OTHER}','published'
 FROM ontology_node_source WHERE code='13030204';
"""
        result = self.run_cli('matches', '--business', '-91001', extra=extra)
        result = [m for m in result if m['seller_business_id'] == -91002]
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['match_type'], 'same_class')
        self.assertEqual(result[0]['seller_representative_id'], OTHER)

    def test_keyword_search(self):
        result = self.run_cli('search', 'Calendar refill')
        self.assertGreater(len(result), 0)


if __name__ == '__main__':
    unittest.main()
