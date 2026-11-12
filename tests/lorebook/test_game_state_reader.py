"""Actual accepted-book reads, through pull-only current-save trace admission."""
import copy
import json
from pathlib import Path
import sys
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / 'public/lorebook/bundle'
sys.path[:0] = [str(BUNDLE / 'vendor'), str(BUNDLE), str(ROOT / 'tools')]
from lorebank.runtime_reader import RuntimePack
from lorebook_game_state import game_state_reader
from lorebook_disclosure import Disclosure

POLICY = ROOT / 'tools/lorebook-game-state-catalogue.json'


class GameStateReaderTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.pack = RuntimePack(BUNDLE)
        cls.policy = json.loads(POLICY.read_text())
        cls.rule = next(r for r in cls.policy['rules'] if r['id'] == 'refugee_course_northrend')

    def context(self):
        return dict(origin='verified_current_game_state', campaign_id='test-campaign', timeline_id='test-fork',
            actor_id='2', as_of='0603-01-03', setting_sha256=self.pack.manifest['files']['expanded']['sha256'],
            current_state_digest=self.policy['digest'], acting_owner='ordinary', observed_actor_id='2',
            clock=dict(totalDays=212796, year=603, month=1, day=3),
            values={r['id']: None for r in self.policy['rules']})

    def reader(self, context):
        return game_state_reader(self.pack, context, POLICY)

    def test_world_state_alone_does_not_grant_private_choice_knowledge(self):
        context = self.context()
        context['values']['theramore_departure_started'] = True
        reader = self.reader(context)
        self.assertEqual(reader.known, frozenset())
        with self.assertRaises(ValueError):
            reader.read(self.rule['account']['branch_id'])

    def test_inherited_culture_is_searchable_through_the_current_state_reader(self):
        context = self.context()
        policy = json.loads((ROOT / 'tools/lorebook-observed-bindings.json').read_text())
        root = next(r['lineageFact'] for r in policy['lineageBindings'] if r['lineageFact']['key'] == 'wildhammer')
        context['common_context'] = dict(origin='verified_current_culture', campaign_id=context['campaign_id'],
            timeline_id=context['timeline_id'], actor_id='2', as_of=context['as_of'], setting_sha256=context['setting_sha256'],
            culture_heritage=policy['bindings'][0]['heritageFact'], culture_lineage=[root])
        reader = self.reader(context)
        query = 'How do Wildhammer clans care for their gryphons?'
        result = Disclosure(self.pack).deliver(reader, query, reader.candidate_ids(query), automatic=False, max_accounts=1)
        self.assertEqual([p['node_id'] for p in result['passages']], ['expanded:people:003:chapter:3'])

    def test_report_and_inherited_culture_survive_together_in_current_state_context(self):
        context = self.context()
        policy = json.loads((ROOT / 'tools/lorebook-observed-bindings.json').read_text())
        root = next(r['lineageFact'] for r in policy['lineageBindings'] if r['lineageFact']['key'] == 'wildhammer')
        context['common_context'] = dict(origin='verified_current_culture', campaign_id=context['campaign_id'],
            timeline_id=context['timeline_id'], actor_id='2', as_of=context['as_of'], setting_sha256=context['setting_sha256'],
            culture_heritage=policy['bindings'][0]['heritageFact'], culture_lineage=[root])
        context['reported_context'] = dict(origin='user_reported', campaign_id=context['campaign_id'],
            timeline_id=context['timeline_id'], start_date='0582-12-31', as_of=context['as_of'], mod_version='0.6.5', choices=[],
            lore_knowledge=dict(actor_id='2', as_of=context['as_of'], setting_sha256=context['setting_sha256'], known_subjects=['expanded:people:030']))
        reader = self.reader(context); query = 'How do your people care for gryphons?'
        result = Disclosure(self.pack).deliver(reader, query, reader.candidate_ids(query), automatic=False, max_accounts=1)
        self.assertEqual([p['node_id'] for p in result['passages']], ['expanded:people:003:chapter:3'])
        self.assertTrue(reader.read('expanded:people:030:chapter:4')['text'])
        self.assertNotIn('War of the Three Hammers', reader.read('expanded:people:003')['text'])

    def test_false_or_unavailable_trace_never_selects_the_opposite_account(self):
        for value in [False, None]:
            context = self.context()
            context['values'][self.rule['id']] = value
            reader = self.reader(context)
            for branch in ['goa:branch:theramore_events.002:0', 'goa:branch:theramore_events.002:2']:
                with self.assertRaises(ValueError):
                    reader.read(branch)

    def test_all_nine_supported_owned_traces_retain_exact_account_and_nested_prose(self):
        for rule in [r for r in self.policy['rules'] if 'account' in r]:
            with self.subTest(rule=rule['id']):
                context = self.context()
                context['values'][rule['id']] = True
                reader = self.reader(context)
                branch = rule['account']['branch_id']
                for node in [branch, branch + ':consequences']:
                    self.assertEqual(reader.read(node)['text'], self.pack.reference.upstream.read(node)['text'])
                self.assertEqual(reader.read(branch)['children'][0]['node_id'], branch + ':consequences')
                evidence = reader.observed_turning(branch, reader.read(branch)['text'])
                self.assertEqual(evidence['observed_at'], context['as_of'])
                self.assertIsNone(evidence['occurred_at'])
                self.assertNotIn('memory', evidence)

    def test_replacement_controller_does_not_inherit_the_original_actors_trace(self):
        context = self.context()
        context['values'][self.rule['id']] = True
        context['acting_owner'] = 'fallen'
        with self.assertRaises(ValueError):
            self.reader(context).read(self.rule['account']['branch_id'])

    def test_reading_an_owned_trace_does_not_grant_unrelated_turnings(self):
        context = self.context()
        context['values'][self.rule['id']] = True
        reader = self.reader(context)
        for branch in ['goa:branch:wc_arthas_story.30:1', 'goa:branch:WCDRA.3:1']:
            with self.assertRaises(ValueError):
                reader.read(branch)

    def test_disclosure_supplies_the_exact_account_then_deepens_on_request(self):
        context = self.context()
        context['values'][self.rule['id']] = True
        reader = self.reader(context)
        disclosure = Disclosure(self.pack)
        query = 'Tell me about The Fleet Turns North.'
        first = disclosure.deliver(reader, query, reader.candidate_ids(query), automatic=False, max_accounts=1)
        self.assertEqual([p['node_id'] for p in first['passages']], [self.rule['account']['branch_id']])
        self.assertEqual(first['passages'][0]['observed_turning']['kind'], 'verified_current_state_trace')
        deeper = disclosure.deliver(reader, 'Tell me more.', [], previous=first['state'], automatic=False, max_accounts=1)
        self.assertEqual([p['node_id'] for p in deeper['passages']], [self.rule['account']['branch_id'] + ':consequences'])

    def test_changed_trace_invalidates_disclosure_but_unrelated_world_status_does_not(self):
        context = self.context()
        context['values'][self.rule['id']] = True
        reader = self.reader(context)
        other = copy.deepcopy(context)
        other['values']['horde_invasion_started'] = True
        self.assertEqual(reader.fingerprint, self.reader(other).fingerprint)
        other['values'][self.rule['id']] = False
        self.assertNotEqual(reader.fingerprint, self.reader(other).fingerprint)

    def test_partial_spoofed_and_wrong_edition_contexts_are_refused(self):
        for kind in ['missing', 'extra', 'number', 'origin', 'edition', 'date', 'setting']:
            with self.subTest(kind=kind):
                context = self.context()
                if kind == 'missing':
                    context['values'].pop(self.rule['id'])
                if kind == 'extra':
                    context['values']['uninspected'] = True
                if kind == 'number':
                    context['values'][self.rule['id']] = 1
                if kind == 'origin':
                    context['origin'] = 'user_reported'
                if kind == 'edition':
                    context['current_state_digest'] = 'f' * 64
                if kind == 'date':
                    context['as_of'] = '0603-01-04'
                if kind == 'setting':
                    context['setting_sha256'] = 'e' * 64
                with self.assertRaises(ValueError):
                    self.reader(context)

    def test_contradictory_destinations_cannot_authorize_both_histories(self):
        context = self.context()
        context['values']['refugee_course_northrend'] = True
        context['values']['refugee_course_pandaria'] = True
        with self.assertRaisesRegex(ValueError, 'Contradictory'):
            self.reader(context)

    def test_another_actor_cannot_borrow_the_same_capture(self):
        context = self.context()
        context['values'][self.rule['id']] = True
        context['actor_id'] = '3'
        with self.assertRaisesRegex(ValueError, 'another character'):
            self.reader(context)


if __name__ == '__main__':
    unittest.main()
