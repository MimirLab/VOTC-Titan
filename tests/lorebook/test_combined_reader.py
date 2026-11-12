"""Independent reported history and live parent-culture knowledge can coexist."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2];BUNDLE=ROOT/'public/lorebook/bundle'
sys.path[:0]=[str(BUNDLE/'vendor'),str(BUNDLE),str(ROOT/'tools')]
from lorebank.runtime_reader import RuntimePack
from lorebank.reader import search_expression
from lorebook_observed import combined_reader
from lorebook_disclosure import Disclosure


class CombinedReaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack=RuntimePack(BUNDLE)
        cls.policy=json.loads((ROOT/'tools/lorebook-observed-bindings.json').read_text())
        spec=importlib.util.spec_from_file_location('combined_lorebook_worker',ROOT/'tools/lorebook-worker.py')
        cls.worker=importlib.util.module_from_spec(spec);argv=sys.argv
        try:
            sys.argv=[str(ROOT/'tools/lorebook-worker.py'),str(BUNDLE)];spec.loader.exec_module(cls.worker)
        finally:sys.argv=argv
        cls.worker.search_expression=search_expression;cls.worker.disclosure=Disclosure(cls.pack)

    def contexts(self,known=()):
        edition=self.pack.manifest['files']['expanded']['sha256'];date='0583-01-01'
        root=next(x['lineageFact'] for x in self.policy['lineageBindings'] if x['lineageFact']['key']=='wildhammer')
        report=dict(origin='user_reported',campaign_id='fixture-campaign',timeline_id='fixture-timeline',
                    start_date='0582-12-31',as_of=date,mod_version='0.6.5',choices=[],
                    lore_knowledge=dict(actor_id='2',as_of=date,setting_sha256=edition,known_subjects=list(known)))
        common=dict(origin='verified_current_culture',campaign_id='fixture-campaign',timeline_id='fixture-timeline',
                    actor_id='2',as_of=date,setting_sha256=edition,
                    culture_heritage=self.policy['bindings'][0]['heritageFact'],culture_lineage=[root])
        return copy.deepcopy(report),copy.deepcopy(common)

    def test_independent_report_and_parent_custom_are_both_readable(self):
        report,common=self.contexts(['expanded:people:030']);reader=combined_reader(self.pack,report,common)
        self.assertIn('nesting gryphons',reader.read('expanded:people:003:chapter:3')['text'])
        self.assertTrue(reader.read('expanded:people:030:chapter:4')['text'])
        self.assertEqual(reader.known,frozenset(['expanded:people:030']))
        self.assertIn('expanded:people:003:chapter:3',reader.admitted)

    def test_cultural_familiarity_does_not_open_unreported_history(self):
        report,common=self.contexts();reader=combined_reader(self.pack,report,common)
        root=reader.read('expanded:people:003')
        self.assertNotIn('War of the Three Hammers',root['text'])
        self.assertFalse(any(c['node_id'].startswith('editorial-node_') for c in root['children']))
        with self.assertRaises(ValueError):reader.read('expanded:people:003:chapter:1')

    def test_context_owner_timeline_date_and_edition_must_match(self):
        for field,value in [('actor_id','3'),('campaign_id','elsewhere'),('timeline_id','fork2'),
                            ('as_of','0583-01-02'),('setting_sha256','a'*64)]:
            report,common=self.contexts();common[field]=value
            with self.subTest(field=field),self.assertRaises(ValueError):combined_reader(self.pack,report,common)

    def test_a_changed_parent_revokes_old_navigation_cursors(self):
        report,common=self.contexts(['expanded:people:001','expanded:people:030'])
        first=combined_reader(self.pack,report,common);cursor=first.reference.__class__.cursor(first,1,'combined-read:expanded:people:003')
        common['culture_lineage']=[];second=combined_reader(self.pack,report,common)
        self.assertNotEqual(first.fingerprint,second.fingerprint)
        with self.assertRaises(ValueError):second.read('expanded:people:003',cursor)

    def test_combined_navigation_pages_without_repeating_or_dropping_children(self):
        report,common=self.contexts([f'expanded:people:{n:03}' for n in range(1,16)])
        reader=combined_reader(self.pack,report,common);node='expanded:group:kindreds'
        first=reader.read(node);self.assertIsNotNone(first['next_cursor'])
        second=reader.read(node,first['next_cursor'])
        a={item['node_id'] for item in first['children']};b={item['node_id'] for item in second['children']}
        self.assertFalse(a&b);self.assertTrue(b)
        self.assertEqual(first['text'],second['text'])

    def test_selected_reported_turning_remains_available_without_granting_another_outcome(self):
        report,common=self.contexts();branch='goa:branch:order_of_the_silver_hand_events.001:0'
        row=self.pack.reference.upstream.branches[branch]
        report['choices']=[dict(branch_id=branch,definition_sha256=json.loads(row['evidence_json'])['source']['block_sha256'],
            occurred_at=report['as_of'],option_index=json.loads(row['selectors_json'])[0]['option_index'],
            actor_context={'fixture':True},guard_evidence={'fixture':True})]
        reader=combined_reader(self.pack,report,common)
        self.assertTrue(reader.read(branch)['text'])
        self.assertIn('nesting gryphons',reader.read('expanded:people:003:chapter:3')['text'])
        with self.assertRaises(ValueError):reader.read('goa:branch:order_of_the_silver_hand_events.001:1')

    def test_actual_worker_uses_parent_knowledge_beside_an_empty_report(self):
        report,common=self.contexts();context=dict(origin='verified_report_and_culture',reported_context=report,common_context=common)
        result=self.worker.run(self.pack,dict(op='combined-disclose',context=context,
            query='How do your people care for gryphons?',candidate_ids=[],automatic=False,max_accounts=1))
        self.assertEqual([p['node_id'] for p in result['passages']],['expanded:people:003:chapter:3'])
        self.assertIn('good meat',result['text'])

    def test_invalid_combined_envelope_is_rejected(self):
        report,common=self.contexts()
        with self.assertRaises(ValueError):self.worker.run(self.pack,dict(op='combined-disclose',
            context=dict(origin='user_reported',reported_context=report,common_context=common),query='gryphons'))


if __name__=='__main__':unittest.main()
