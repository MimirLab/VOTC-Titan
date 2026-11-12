"""Parent-culture familiarity uses captured source facts and qualified common lore."""
import copy
import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / 'public/lorebook/bundle'
sys.path[:0] = [str(BUNDLE / 'vendor'), str(BUNDLE), str(ROOT / 'tools')]
from lorebank.runtime_reader import RuntimePack
from lorebank.reader import search_expression
from lorebook_observed import observed_reader
from lorebook_disclosure import Disclosure


class ObservedLineageTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = RuntimePack(BUNDLE)
        cls.policy = json.loads((ROOT / 'tools/lorebook-observed-bindings.json').read_text())
        spec = importlib.util.spec_from_file_location('lineage_lorebook_worker', ROOT / 'tools/lorebook-worker.py')
        cls.worker = importlib.util.module_from_spec(spec)
        argv = sys.argv
        try:
            sys.argv = [str(ROOT / 'tools/lorebook-worker.py'), str(BUNDLE)]
            spec.loader.exec_module(cls.worker)
        finally:
            sys.argv = argv
        cls.worker.search_expression = search_expression

    def context(self, roots=()):
        heritage = next(b['heritageFact'] for b in self.policy['bindings'] if b['heritageFact']['key'] == 'heritage_arathi')
        facts = [next(b['lineageFact'] for b in self.policy['lineageBindings'] if b['lineageFact']['key'] == k) for k in roots]
        return dict(origin='verified_current_culture', campaign_id='fixture-campaign', timeline_id='fixture-timeline',
                    actor_id='2', as_of='0583-01-01', setting_sha256=self.pack.manifest['files']['expanded']['sha256'],
                    culture_heritage=copy.deepcopy(heritage), culture_lineage=copy.deepcopy(facts))

    def test_hybrid_familiarity_includes_both_parent_roots_and_current_heritage(self):
        reader = observed_reader(self.pack, self.context(['wildhammer', 'bronzebeard']))
        self.assertIn('expanded:people:003', reader.known)
        self.assertIn('expanded:people:002', reader.known)
        self.assertIn('expanded:people:001', reader.known)
        self.assertIn('nesting gryphons', reader.read('expanded:people:003:chapter:3')['text'])
        self.assertIn('expanded:people:002:chapter:3', reader.admitted)
        self.assertNotIn('expanded:people:030:chapter:4', reader.admitted)

    def test_changed_or_unobserved_parent_does_not_grant_the_source(self):
        context = self.context(['wildhammer'])
        context['culture_lineage'][0]['rules'] += 'changed'
        reader = observed_reader(self.pack, context)
        self.assertNotIn('expanded:people:003', reader.known)
        self.assertIn('expanded:people:001', reader.known)
        self.assertNotIn('expanded:people:003:chapter:3', reader.admitted)

    def test_a_known_parent_is_sufficient_when_current_heritage_has_no_mapping(self):
        context = self.context(['wildhammer'])
        context['culture_heritage']['key'] = 'unmapped_current_heritage'
        reader = observed_reader(self.pack, context)
        self.assertEqual(reader.known, frozenset(['expanded:people:003']))

    def test_duplicate_lineage_and_unmapped_context_are_rejected(self):
        context = self.context(['wildhammer'])
        context['culture_lineage'].append(copy.deepcopy(context['culture_lineage'][0]))
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            observed_reader(self.pack, context)
        context = self.context()
        context['culture_heritage']['key'] = 'unmapped_current_heritage'
        with self.assertRaisesRegex(ValueError, 'Unmapped'):
            observed_reader(self.pack, context)

    def test_subject_familiarity_does_not_open_reference_only_or_other_parent_history(self):
        reader = observed_reader(self.pack, self.context(['wildhammer']))
        self.assertNotIn('expanded:people:003:chapter:1', reader.admitted)
        with self.assertRaises(ValueError):
            reader.read('expanded:people:003:chapter:1')
        with self.assertRaises(ValueError):
            reader.read('expanded:people:002:chapter:3')

    def test_gryphon_question_can_retrieve_inherited_custom_without_forcing_it_into_every_turn(self):
        reader = observed_reader(self.pack, self.context(['wildhammer']))
        query = 'How do Wildhammer clans care for their gryphons?'
        candidates = list(dict.fromkeys(reader.candidate_ids(query) + self.worker.candidate_search(self.pack, query)))[:100]
        result = Disclosure(self.pack).deliver(reader, query, candidates, automatic=False, max_accounts=1)
        self.assertTrue(any(p['node_id'] == 'expanded:people:003:chapter:3' for p in result['passages']))
        quiet = 'Please stay here quietly with me for a moment.'
        candidates = list(dict.fromkeys(reader.candidate_ids(quiet) + self.worker.candidate_search(self.pack, quiet)))[:100]
        other = Disclosure(self.pack).deliver(reader, quiet, candidates, automatic=True, max_accounts=1)
        self.assertFalse(any(p['node_id'] == 'expanded:people:003:chapter:3' for p in other['passages']))

    def test_a_personal_question_can_resolve_a_distinctive_parent_topic_without_naming_the_culture(self):
        reader = observed_reader(self.pack, self.context(['wildhammer']))
        query = 'How do your people care for gryphons?'
        candidates = list(dict.fromkeys(reader.candidate_ids(query) + self.worker.candidate_search(self.pack, query)))[:100]
        result = Disclosure(self.pack).deliver(reader, query, candidates, automatic=False, max_accounts=1)
        self.assertEqual([p['node_id'] for p in result['passages']], ['expanded:people:003:chapter:3'])
        unrelated = observed_reader(self.pack, self.context())
        self.assertEqual(unrelated.named_subjects(query), [])


if __name__ == '__main__':
    unittest.main()
