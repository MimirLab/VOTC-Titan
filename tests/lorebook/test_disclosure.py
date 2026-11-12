"""Structural fixtures; actual accepted-engine scenes are checked separately."""
from pathlib import Path
import json,sqlite3,sys,tempfile,types,unittest
from contextlib import closing
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'tools'))
from lorebook_disclosure import Disclosure,active_query,focus_query,reported_resolution,context_only_advance,anchors


class Fixture:
    def __init__(self,directory):
        self.file=Path(directory)/'catalog.sqlite3';self.allowed={'root','chapter','leaf','deep','other'};self.hidden=set()
        self.rows=[('root','Scholars',None,'root','The scholars preserve learning.'),('chapter','Herbal Practice','root','root','Their herbal practice concerns careful study.'),
                   ('leaf','Salves','chapter','root','A salve is prepared from selected herbs.'),('deep','Preparation','leaf','root','Preparing a salve requires clean water.'),
                   ('other','Rivals',None,'other','The rivals study the stars.'),
                   ('village','A Village',None,'village','The village stands here.'),('festival','A Local Festival','village','village','This village celebrates a local festival.')]
        self.allowed.update({'village','festival'})
        self.bodies={r[0]:r[4]for r in self.rows}
        with sqlite3.connect(self.file)as c:
            c.executescript('CREATE TABLE nodes(id,canonical_id,family,title,parent_id,entry_node_id);CREATE TABLE passages(id,node_id,entry_node_id,family,title,text,body_sha256,embed,selector_json);CREATE TABLE aliases(name,target_id,kind);CREATE TABLE edges(source_id,target_id,relation);')
            for n,title,parent,root,body in self.rows:
                c.execute('INSERT INTO nodes VALUES(?,?,?,?,?,?)',(n,n,'expanded',title,parent,root))
                c.execute('INSERT INTO passages VALUES(?,?,?,?,?,?,?,?,?)',(n,n,root,'expanded',title,'RAW FUTURE ACCOUNT: '+body,'bodyhash',1,'{}'))
            c.executemany('INSERT INTO aliases VALUES(?,?,?)',[('scholars','root','name_alias'),('rivals','other','name_alias')])
        c.close()
        self.bundle=types.SimpleNamespace(connect=self.connect,resolve=self.resolve)
        self.reader=types.SimpleNamespace(fingerprint='context-a',state={'lore_knowledge':{'actor_id':'actor-a'}},read=self.read,
                                          upstream=types.SimpleNamespace(active={}))
    def connect(self):
        c=sqlite3.connect(self.file);c.row_factory=sqlite3.Row;return c
    def read(self,node,cursor=None):
        if node in self.hidden or node not in self.bodies:raise ValueError('unavailable')
        row=next(r for r in self.rows if r[0]==node)
        return dict(node_id=node,title=row[1],text=self.bodies[node],parent=None,children=[dict(node_id=r[0],title=r[1])for r in self.rows if r[2]==node and r[0]not in self.hidden],next_cursor=None)
    def resolve(self,ids,reader,max_words):
        passages=[];trace=[]
        for n in ids:
            if n in self.allowed and n not in self.hidden:
                passages.append(dict(node_id=n,title=self.read(n)['title'],text=self.bodies[n],heading=self.read(n)['title']));status='accepted'
            else:status='unqualified_authored_candidate'
            trace.append(dict(candidate=n,status=status))
        return dict(passages=passages,trace=trace)


class DisclosureTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.f=Fixture(self.temp.name);self.d=Disclosure(self.f)
    def tearDown(self):self.temp.cleanup()
    def run_query(self,q,state=None,ids=None,**kw):return self.d.deliver(self.f.reader,q,ids or ['root','chapter','leaf','deep','other'],previous=state,**kw)
    def exhausted_state(self):
        value=self.run_query('Tell me about scholars.')
        for _ in range(12):
            before=value['state'];value=self.run_query('Tell me more.',before)
            if not value['passages']:return before
        self.fail('Fixture chapter was not exhausted')
    def add_concept_routes(self):
        light='editorial-node_f579b752ca179d01d7b07be3';coins='editorial-node_769aa1e2cbc189ed383e7cba'
        with closing(self.f.connect())as c,c:
            for ident,title,names in [(light,'The Light',['The Light','Light']),(coins,'Coinage and Payment',['Coinage and Payment','Coins','Coin'])]:
                c.execute('INSERT INTO nodes VALUES(?,?,?,?,?,?)',(ident,ident,'base',title,None,ident))
                c.executemany('INSERT INTO aliases VALUES(?,?,?)',[(n,ident,'name_alias') for n in names])
        self.d=Disclosure(self.f)
        return light,coins
    def test_contextual_concept_routes_are_opt_in_not_new_reader_grants(self):
        light,coins=self.add_concept_routes()
        for q,root in [('What does the Light mean to your neighbours?',light),('Does the master charge seven coins for release?',coins)]:
            self.assertEqual(anchors(self.f,q),[root])
            self.assertEqual(anchors(self.f,q,contextual_topics=True),[])
            args=dict(semantic_relevance=True,semantic_matches=[dict(id='leaf',score=.42)])
            self.assertEqual([p['node_id']for p in self.run_query(q,**args)['passages']],['leaf'])
            self.f.allowed.remove('leaf')
            self.assertEqual(self.run_query(q,**args)['passages'],[])
            self.f.allowed.add('leaf')
    def test_explicit_concept_topics_capitalized_coin_and_other_names_stay_strict(self):
        light,coins=self.add_concept_routes()
        for q,root in [('Explain the Light.',light),('Tell me about coins.',coins),('Explain Coinage and Payment in this community.',coins),('Does Coins have a fixed value for this family?',coins),('What do rivals know about salves?', 'other')]:
            self.assertEqual(anchors(self.f,q,contextual_topics=True),[root],q)
            self.assertEqual(self.run_query(q,semantic_relevance=True,semantic_matches=[dict(id='leaf',score=.42)])['passages'],[],q)
    def test_concept_route_requires_exact_canonical_catalogue_role(self):
        light,_=self.add_concept_routes();q='What does the Light mean to your neighbours?'
        for column,value in [('title','A Different Light'),('family','expanded'),('canonical_id','other'),('parent_id','root')]:
            with closing(self.f.connect())as c,c:
                old=c.execute('SELECT '+column+' FROM nodes WHERE id=?',(light,)).fetchone()[0]
                c.execute('UPDATE nodes SET '+column+'=? WHERE id=?',(value,light))
            self.assertEqual(anchors(self.f,q,contextual_topics=True),[light],column)
            with closing(self.f.connect())as c,c:c.execute('UPDATE nodes SET '+column+'=? WHERE id=?',(old,light))
    def test_soft_concept_aliases_cannot_displace_a_later_strict_named_root(self):
        self.add_concept_routes()
        with closing(self.f.connect())as c,c:c.execute('INSERT INTO aliases VALUES(?,?,?)',('Zo','other','name_alias'))
        # The two longer concept aliases sort first. Filter them before the
        # two-hard-root cap, preserving even this shortest identity mention.
        q='What does the Light mean to your neighbours when coins are paid to Zo?'
        self.assertEqual(anchors(self.f,q,contextual_topics=True),['other'])
        self.assertEqual(self.run_query(q,semantic_relevance=True,semantic_matches=[dict(id='leaf',score=.42)])['passages'],[])
    def test_scored_semantic_recall_is_opt_in_and_keeps_resolver_body(self):
        query='How might a novice soothe a burn?';matches=[dict(id='leaf',score=.42)]
        self.assertEqual(self.run_query(query,semantic_matches=matches)['passages'],[])
        value=self.run_query(query,semantic_relevance=True,semantic_matches=matches)
        self.assertEqual([p['node_id'] for p in value['passages']],['leaf'])
        self.assertEqual(value['passages'][0]['text'],self.f.bodies['leaf'])
        self.assertNotIn('RAW FUTURE',value['text'])
    def test_semantic_margin_compares_only_source_admitted_candidates(self):
        self.f.allowed.remove('other')
        value=self.run_query('How might a novice soothe a burn?',semantic_relevance=True,
                             semantic_matches=[dict(id='other',score=.8),dict(id='leaf',score=.42),dict(id='chapter',score=.31)])
        self.assertEqual([p['node_id'] for p in value['passages']],['leaf'])
    def test_semantic_ambiguity_and_low_scores_do_not_force_a_body(self):
        for matches in [[dict(id='leaf',score=.28)], [dict(id='leaf',score=.4),dict(id='chapter',score=.39)], [dict(id='leaf',score=.1)]]:
            self.assertEqual(self.run_query('How might a novice soothe a burn?',semantic_relevance=True,semantic_matches=matches)['passages'],[])
    def test_semantic_recall_preserves_ancestor_budget_dedup_and_source_revocation(self):
        args=dict(semantic_relevance=True,semantic_matches=[dict(id='leaf',score=.42)])
        q='How might a novice soothe a burn?'
        self.assertEqual(self.run_query(q,max_words=1,**args)['passages'],[])
        self.assertEqual(self.run_query(q,existing=self.f.bodies['leaf'],**args)['passages'],[])
        self.f.hidden.add('chapter');self.assertEqual(self.run_query(q,**args)['passages'],[])
        self.f.hidden.clear();self.f.allowed.remove('leaf');self.assertEqual(self.run_query(q,**args)['passages'],[])
    def test_semantic_scene_recall_retains_context_origin_and_quiet_deferral(self):
        args=dict(scene_relevance=True,semantic_relevance=True,semantic_matches=[dict(id='leaf',score=.42)])
        value=self.run_query('I need relief for a burning wound.',**args)
        self.assertEqual([p['node_id'] for p in value['passages']],['leaf'])
        self.assertEqual(value['state']['focus_origin'],'scene')
        for q in ['Please just sit beside me.','The salve and herbs can wait. Please just hold my hand.']:
            self.assertEqual(self.run_query(q,**args)['passages'],[])
    def test_scored_semantic_matches_have_a_bounded_finite_candidate_contract(self):
        for matches in [[dict(id='outside',score=.8)],[dict(id='leaf',score=float('nan'))],[dict(id='leaf',score=True)],
                        [dict(id='leaf',score=.5),dict(id='leaf',score=.6)],[dict(id='leaf',score=.5,text='invented')]]:
            with self.assertRaisesRegex(ValueError,'scored semantic'):
                self.run_query('How might a novice soothe a burn?',semantic_relevance=True,semantic_matches=matches)
    def test_yes_no_questions_can_keep_scored_candidates_without_a_wh_word(self):
        q='Does a novice require warmth after a burn?'
        self.assertEqual(self.run_query(q)['passages'],[])
        value=self.run_query(q,semantic_relevance=True,semantic_matches=[dict(id='leaf',score=.42)])
        self.assertEqual([p['node_id']for p in value['passages']],['leaf'])
    def test_inferred_semantic_context_does_not_claim_a_public_account_was_explained(self):
        args=dict(semantic_relevance=True,semantic_matches=[dict(id='leaf',score=.42)])
        first=self.run_query('How might a novice soothe a burn?',**args)
        self.assertEqual(first['state']['focus_origin'],'scene')
        next_turn=self.run_query('Go on.',first['state'])
        self.assertEqual(next_turn['disclosure']['mode'],'scene_continue')
        self.assertEqual(next_turn['passages'],[])
        explicit=self.run_query('Tell me more about that custom.',first['state'])
        self.assertEqual([p['node_id']for p in explicit['passages']],['leaf'])
        self.assertNotIn('focus_origin',explicit['state'])
    def test_complete_scores_use_actual_eligible_runner_up_without_lowering_threshold(self):
        matches=[dict(id='leaf',score=.253),dict(id='chapter',score=.177)]
        self.assertEqual(self.run_query('How might a novice soothe a burn?',semantic_relevance=True,semantic_matches=matches)['passages'],[])
        value=self.run_query('How might a novice soothe a burn?',semantic_relevance=True,semantic_matches=matches,semantic_complete=True)
        self.assertEqual([p['node_id']for p in value['passages']],['leaf'])
    def test_complete_score_metadata_does_not_become_literal_candidate_recall(self):
        value=self.d.deliver(self.f.reader,'Would careful herbal study help a novice soothe a burn?',[],
                             semantic_relevance=True,semantic_complete=True,
                             semantic_matches=[dict(id='leaf',score=.42),dict(id='chapter',score=.2)])
        self.assertEqual([p['node_id']for p in value['passages']],['leaf'])
    def test_weak_complete_scores_do_not_create_false_unknown_knowledge_guidance(self):
        value=self.d.deliver(self.f.reader,'How are you feeling tonight?',[],semantic_relevance=True,semantic_complete=True,
                             semantic_matches=[dict(id='leaf',score=.1),dict(id='chapter',score=.08)])
        self.assertEqual(value['passages'],[]);self.assertEqual(value['disclosure']['probes'],0)
        self.assertEqual(value['disclosure']['access'],'not_requested')
    def test_quiet_request_suppresses_literal_and_semantic_lore_without_erasing_explicit_information(self):
        args=dict(semantic_relevance=True,semantic_matches=[dict(id='leaf',score=.42)])
        for q in ['Let them discuss salves; please hold my hand in silence.',
                  'I know how their herbal practice works. I need your company, not another explanation.']:
            self.assertEqual(self.run_query(q,**args)['passages'],[])
        value=self.run_query('Please just sit beside me. Explain how scholars prepare salves.',**args)
        self.assertTrue(value['passages'])
    def test_opt_in_scene_relevance_delivers_one_whole_resolved_account(self):
        query='I set selected herbs beside the salve.'
        self.assertEqual(self.run_query(query)['passages'],[])
        value=self.run_query(query,scene_relevance=True)
        self.assertEqual(value['disclosure']['mode'],'scene')
        self.assertEqual(value['disclosure']['intent'],'none')
        self.assertEqual([p['node_id']for p in value['passages']],['leaf'])
        self.assertEqual(value['passages'][0]['text'],self.f.bodies['leaf'])
        self.assertNotIn('RAW FUTURE ACCOUNT',value['text'])
    def test_scene_context_does_not_turn_bare_RP_progress_into_information(self):
        first=self.run_query('I set selected herbs beside the salve.',scene_relevance=True)
        self.assertEqual(first['state']['focus_origin'],'scene')
        for query in ['Go on.','Continue.','More.']:
            value=self.run_query(query,first['state'],scene_relevance=True)
            self.assertEqual(value['passages'],[])
            self.assertEqual(value['disclosure']['access'],'not_requested')
            self.assertEqual(value['disclosure']['intent'],'none')
            self.assertEqual(value['disclosure']['mode'],'scene_continue')
            self.assertEqual(value['state'],first['state'])
            self.assertTrue(context_only_advance(query,first['state']))
    def test_explicit_information_reoffers_scene_body_before_its_child(self):
        first=self.run_query('I set selected herbs beside the salve.',scene_relevance=True)
        held=self.run_query('Go on.',first['state'],scene_relevance=True)
        requested=self.run_query('Tell me more.',held['state'],scene_relevance=True)
        self.assertEqual([p['node_id']for p in requested['passages']],['leaf'])
        self.assertEqual(requested['passages'][0]['text'],self.f.bodies['leaf'])
        self.assertNotIn('focus_origin',requested['state'])
        deeper=self.run_query('Go on.',requested['state'],scene_relevance=True)
        self.assertEqual([p['node_id']for p in deeper['passages']],['deep'])
    def test_scene_origin_is_not_a_grant_or_an_actor_context_override(self):
        first=self.run_query('I set selected herbs beside the salve.',scene_relevance=True)
        self.f.allowed.remove('leaf')
        self.assertEqual(self.run_query('Tell me more.',first['state'],scene_relevance=True)['passages'],[])
        stale={**first['state'],'context':'different-actor-or-date'}
        self.assertNotEqual(self.run_query('Go on.',stale,scene_relevance=True)['disclosure']['mode'],'scene_continue')
    def test_requested_information_progression_remains_ordinary_with_scene_mode(self):
        first=self.run_query('Tell me about scholars.',scene_relevance=True)
        self.assertNotIn('focus_origin',first['state'])
        self.assertFalse(context_only_advance('Go on.',first['state']))
        self.assertEqual([p['node_id']for p in self.run_query('Go on.',first['state'],scene_relevance=True)['passages']],['chapter'])
    def test_scene_relevance_preserves_quiet_weak_and_deferred_turns(self):
        for query in ['Sit beside me.','I hold a salve.','Selected herbs beside the salve can wait. Sit with me.',
                      'We have selected herbs and a salve. Please just stay with me.']:
            self.assertEqual(self.run_query(query,scene_relevance=True)['passages'],[],query)
    def test_scene_relevance_cannot_restore_revoked_or_hidden_ancestors(self):
        query='I set selected herbs beside the salve.'
        self.f.allowed.remove('leaf')
        self.assertEqual(self.run_query(query,scene_relevance=True)['passages'],[])
        self.f.allowed.add('leaf');self.f.hidden.add('chapter')
        value=self.run_query(query,scene_relevance=True)
        self.assertEqual(value['passages'],[])
        self.assertTrue(any(t['status']=='unavailable_ancestor'for t in value['trace']))
    def test_scene_relevance_obeys_whole_body_budget_and_context_deduplication(self):
        query='I set selected herbs beside the salve.'
        self.assertEqual(self.run_query(query,scene_relevance=True,max_words=1)['passages'],[])
        value=self.run_query(query,scene_relevance=True,existing=self.f.bodies['leaf'])
        self.assertEqual(value['passages'],[])
        self.assertEqual(value['disclosure']['access'],'existing')
        for invalid in [1,'true',None,[]]:
            with self.assertRaisesRegex(ValueError,'scene relevance'):
                self.run_query(query,scene_relevance=invalid)
    def test_opt_in_recall_revalidates_exact_original_body_without_advancing(self):
        before=self.exhausted_state();snapshot=json.loads(json.dumps(before))
        value=self.run_query('Tell me more.',before,recall_current=True)
        self.assertEqual(value['disclosure']['mode'],'recall')
        self.assertEqual(value['disclosure']['access'],'existing')
        self.assertEqual(value['disclosure']['intent'],'continue')
        self.assertEqual(value['state'],snapshot);self.assertEqual(before,snapshot)
        self.assertEqual([p['node_id']for p in value['passages']],[before['focus']])
        self.assertEqual(value['passages'][0]['text'],self.f.bodies[before['focus']])
        self.assertNotIn('RAW FUTURE ACCOUNT',value['text'])
        self.assertLessEqual(value['words'],350)
        again=self.run_query('Tell me more.',value['state'],recall_current=True)
        self.assertEqual(again['state'],before);self.assertEqual(again['passages'],value['passages'])
    def test_recall_cannot_restore_revoked_or_hidden_body(self):
        before=self.exhausted_state();self.f.allowed.remove(before['focus'])
        self.assertEqual(self.run_query('Tell me more.',before,recall_current=True)['passages'],[])
        self.f.allowed.add(before['focus']);self.f.hidden.add(before['focus'])
        self.assertEqual(self.run_query('Tell me more.',before,recall_current=True)['passages'],[])
    def test_recall_rechecks_visible_ancestors(self):
        before=self.exhausted_state();self.f.hidden.add('chapter')
        value=self.run_query('Tell me more.',before,recall_current=True)
        self.assertEqual(value['passages'],[])
        self.assertTrue(any(row['status']=='unavailable_ancestor'for row in value['trace']))
    def test_recall_has_no_authority_after_context_change_or_without_actual_seen_focus(self):
        before=self.exhausted_state()
        for changed in [{**before,'context':'old-actor-or-date'},{**before,'shown':[]},{**before,'version':'old-version'}]:
            self.assertNotEqual(self.run_query('Tell me more.',changed,recall_current=True)['disclosure']['mode'],'recall')
    def test_recall_budget_and_existing_context_do_not_clip_or_duplicate_the_body(self):
        before=self.exhausted_state()
        limited=self.run_query('Tell me more.',before,recall_current=True,max_words=1)
        self.assertEqual(limited['passages'],[])
        self.assertTrue(any(row['status']=='disclosure_budget_exceeded'for row in limited['trace']))
        present=self.run_query('Tell me more.',before,recall_current=True,existing=self.f.bodies[before['focus']])
        self.assertEqual(present['passages'],[]);self.assertEqual(present['disclosure']['access'],'existing')
    def test_recall_does_not_skip_new_children_or_override_deferral_or_a_new_topic(self):
        first=self.run_query('Tell me about scholars.')
        next_value=self.run_query('Tell me more.',first['state'],recall_current=True)
        self.assertEqual(next_value['disclosure']['mode'],'deepen')
        self.assertEqual(next_value['passages'][0]['node_id'],'chapter')
        before=self.exhausted_state()
        for query in ['More tea, please.','We have more scholars.','The rules can wait. Sit with me.']:
            value=self.run_query(query,before,recall_current=True)
            self.assertEqual(value['passages'],[]);self.assertNotEqual(value['disclosure']['mode'],'recall')
        other=self.run_query('Tell me about rivals.',before,recall_current=True)
        self.assertEqual([p['node_id']for p in other['passages']],['other'])
    def test_recall_remains_opt_in_and_rejects_non_boolean_origin(self):
        before=self.exhausted_state()
        self.assertEqual(self.run_query('Tell me more.',before)['passages'],[])
        for value in [1,'true',[],None]:
            with self.assertRaisesRegex(ValueError,'current-account recall'):
                self.run_query('Tell me more.',before,recall_current=value)
    def test_reported_resolution_requires_an_unambiguous_active_coded_account(self):
        upstream=self.f.reader.upstream
        upstream.mode='history';upstream.state={'origin':'synthetic_test','choices':[]}
        self.assertIsNone(reported_resolution(self.f.reader,'branch','If the defence prevails, the king survives.'))
        upstream.active={'branch':{'kind':'coded_resolution','evidence_json':json.dumps({'source':{'block_sha256':'a'*64}})}}
        choice={'branch_id':'branch','definition_sha256':'a'*64,'occurred_at':'0603-06-01','guard_evidence':{'resolution':'The defence prevailed.'}}
        upstream.state['choices']=[choice]
        value=reported_resolution(self.f.reader,'branch','If the defence prevails, the king survives.')
        self.assertEqual(value['resolution'],'The defence prevailed.');self.assertEqual(value['definition_sha256'],'a'*64)
        self.assertEqual(value['kind'],'reported_campaign_resolution');self.assertEqual(len(value['body_sha256']),64)
        upstream.state['choices']=[choice,choice.copy()]
        self.assertIsNone(reported_resolution(self.f.reader,'branch','Conditional source.'))
        upstream.state['choices']=[choice];upstream.active['branch']['kind']='choice'
        self.assertIsNone(reported_resolution(self.f.reader,'branch','Conditional source.'))
    def test_named_mentions_do_not_override_explicit_deferral_or_companionship(self):
        for query in ['Scholars rules can wait until tomorrow. Sit with me.',
                      'We can discuss scholars herbal practice later. Stay with me.',
                      'The scholars turned me down. Please just stay with me for a while.',
                      'I am sad about the scholars. Please just stay with me.']:
            value=self.run_query(query)
            self.assertEqual(value['text'],'');self.assertEqual(value['state'],{})
            self.assertEqual(value['disclosure']['access'],'not_requested');self.assertEqual(value['disclosure']['probes'],0)
    def test_a_separate_current_request_survives_a_deferred_other_topic(self):
        for query in ['We can discuss rivals later. Explain scholars herbal practice.',
                      'Explain scholars herbal practice. We can discuss rivals later.']:
            self.assertNotIn('rivals',active_query(query).lower())
            self.assertEqual([p['node_id']for p in self.run_query(query)['passages']],['chapter'])
    def test_elliptic_followup_uses_context_for_ranking_without_changing_the_visible_question(self):
        # The real book has IF -> Ironforge; grammatical "if" must not switch topics.
        with closing(self.f.connect())as c,c:c.execute('INSERT INTO aliases VALUES(?,?,?)',('IF','other','name_alias'))
        first=self.run_query('Explain scholars herbal practice.')
        query='And if study is interrupted?'
        value=self.run_query(query,first['state'])
        self.assertEqual([p['node_id']for p in value['passages']],['chapter'])
        self.assertIn(first['state']['focus_title'],focus_query(query,first['state'],[]))
        self.assertEqual(query,'And if study is interrupted?')
    def test_account_and_prior_subject_bounds_are_enforced_without_extra_permissions(self):
        self.assertEqual(len(self.run_query('Compare scholars and rivals.')['passages']),2)
        value=self.run_query('Compare scholars and rivals.',max_accounts=1)
        self.assertEqual(len(value['passages']),1)
        value=self.run_query('Tell me about rivals.',prior_subjects=['root'])
        self.assertEqual(value['passages'][0]['subject_id'],'other')
        value=self.run_query('Tell me about rivals.',prior_subjects=['root','village'])
        self.assertEqual(value['text'],'')
        self.assertTrue(any(t['status']=='subject_budget_exceeded'for t in value['trace']))
        self.assertEqual(self.run_query('Tell me about scholars.',prior_subjects=['root','village'])['passages'][0]['subject_id'],'root')
    def test_invalid_account_and_subject_limits_are_rejected(self):
        for limit in [True,0,4,'1']:
            with self.assertRaises(ValueError):self.run_query('Tell me about scholars.',max_accounts=limit)
        for subjects in [['root','other','village'],['absent-root'],'root']:
            with self.assertRaises(ValueError):self.run_query('Tell me about scholars.',prior_subjects=subjects)
    def test_broad_question_operators_do_not_replace_the_requested_overview(self):
        for query in ['Describe scholars.','Teach me about scholars.','Give me facts about scholars.']:
            value=self.run_query(query);self.assertEqual([p['node_id']for p in value['passages']],['root'])
    def test_a_unique_generic_chapter_title_does_not_anchor_an_unmentioned_people(self):
        n='other-faith';self.f.rows.append((n,'Faith','other','other','The rivals keep a faith in a silent star.'));self.f.bodies[n]=self.f.rows[-1][4];self.f.allowed.add(n)
        with closing(self.f.connect())as c,c:
            c.execute('INSERT INTO nodes VALUES(?,?,?,?,?,?)',(n,n,'expanded','Faith','other','other'))
            c.execute('INSERT INTO passages VALUES(?,?,?,?,?,?,?,?,?)',(n,n,'other','expanded','Faith',self.f.bodies[n],'hash',1,'{}'))
        self.d=Disclosure(self.f)
        self.assertEqual(self.run_query('Explain scholars faith.',ids=[n])['text'],'')
    def test_present_worship_terms_find_faith_without_stealing_an_explicit_historical_question(self):
        extra=[('faith','Faith and Sacred Obligations','root','root','The Holy Light is their spiritual tradition. Its teachers heal and guide the faithful.'),
               ('early','Early Tribes','root','root','The early tribes had followers before familiarity with the Holy Light and practiced nature beliefs.')]
        with closing(self.f.connect())as c,c:
            for n,title,parent,root,body in extra:
                self.f.rows.append((n,title,parent,root,body));self.f.bodies[n]=body;self.f.allowed.add(n)
                c.execute('INSERT INTO nodes VALUES(?,?,?,?,?,?)',(n,n,'expanded',title,parent,root))
                c.execute('INSERT INTO passages VALUES(?,?,?,?,?,?,?,?,?)',(n,n,root,'expanded',title,body,'hash',1,'{}'))
        self.d=Disclosure(self.f)
        query='The scholars account describes followers of the Holy Light. Does that make you a Light worshipper, and can you mend my broken wrist with a miracle?'
        self.assertEqual([p['node_id']for p in self.run_query(query,ids=['early','faith'])['passages']],['faith'])
        historical='Explain the early tribes of scholars before familiarity with the Holy Light.'
        self.assertEqual([p['node_id']for p in self.run_query(historical,ids=['faith','early'])['passages']],['early'])
        self.f.allowed.remove('faith')
        value=self.run_query(query,ids=['faith']);self.assertEqual(value['passages'],[])
    def test_a_second_requested_topic_survives_the_first_topics_score_advantage(self):
        self.f.bodies['chapter']='Their herbal practice carefully studies salves, herbs, and clean water.'
        self.f.bodies['leaf']='Their astronomy concerns stars.'
        self.f.rows=[(n,'Astronomy'if n=='leaf'else title,parent,root,self.f.bodies[n])for n,title,parent,root,body in self.f.rows]
        with closing(self.f.connect())as c,c:
            c.execute('UPDATE passages SET text=? WHERE id=?',(self.f.bodies['chapter'],'chapter'))
            c.execute('UPDATE passages SET title=?,text=? WHERE id=?',('Astronomy',self.f.bodies['leaf'],'leaf'))
            c.execute('UPDATE nodes SET title=? WHERE id=?',('Astronomy','leaf'))
        v=self.run_query('Explain both scholars herbal practice with salves herbs clean water and their stars.',ids=['chapter','leaf'])
        self.assertEqual([p['node_id']for p in v['passages']],['chapter','leaf'])
    def test_overview_and_three_nested_steps_preserve_breadcrumbs(self):
        v=self.run_query('Tell me about scholars.');self.assertEqual([p['node_id']for p in v['passages']],['root'])
        for node,depth in [('chapter',1),('leaf',2),('deep',3)]:
            v=self.run_query('Tell me more.',v['state']);self.assertEqual([p['node_id']for p in v['passages']],[node]);self.assertEqual(v['trace'][-1]['depth'],depth)
        self.assertEqual(v['passages'][0]['heading'],'Scholars — Herbal Practice — Salves — Preparation')
        self.assertNotIn('RAW FUTURE',v['text'])
    def test_specific_question_can_open_deep_account_without_dumping_siblings(self):
        v=self.run_query('How do scholars prepare a salve with clean water?',ids=['deep'])
        self.assertEqual([p['node_id']for p in v['passages']],['deep']);self.assertIn('Scholars — Herbal Practice',v['text']);self.assertNotIn('study the stars',v['text'])
    def test_named_followup_deepens_and_finishes_nested_siblings_in_order(self):
        extra=[('second-leaf','Poultices','chapter','root','A poultice covers the skin.'),('second-chapter','Astronomy','root','root','The scholars also observe the sky.')]
        with closing(self.f.connect())as c,c:
            for n,title,parent,root,body in extra:
                self.f.rows.append((n,title,parent,root,body));self.f.bodies[n]=body;self.f.allowed.add(n)
                c.execute('INSERT INTO nodes VALUES(?,?,?,?,?,?)',(n,n,'expanded',title,parent,root))
                c.execute('INSERT INTO passages VALUES(?,?,?,?,?,?,?,?,?)',(n,n,root,'expanded',title,body,'hash',1,'{}'))
        self.d=Disclosure(self.f)
        v=self.run_query('Tell me about scholars.')
        for node in ['chapter','leaf','deep','second-leaf','second-chapter']:
            v=self.run_query('Tell me more about scholars.',v['state'])
            self.assertEqual([p['node_id']for p in v['passages']],[node])
        self.assertEqual(self.run_query('Tell me more.',v['state'])['text'],'')
    def test_topic_switch_does_not_continue_old_branch(self):
        a=self.run_query('Tell me about scholars.');b=self.run_query('Tell me about rivals.',a['state'])
        self.assertEqual([p['node_id']for p in b['passages']],['other']);self.assertEqual(b['state']['root'],'other')
    def test_an_unavailable_ancestor_blocks_the_leaf(self):
        self.f.hidden.add('chapter');v=self.run_query('clean water salve',ids=['deep'])
        self.assertEqual(v['text'],'');self.assertEqual(v['state'],{})
    def test_unqualified_overview_is_not_injected_as_an_introduction(self):
        self.f.allowed.remove('root');v=self.run_query('Tell me about scholars.')
        self.assertEqual([p['node_id']for p in v['passages']],['chapter']);self.assertNotIn('preserve learning',v['text'])
    def test_word_budget_and_existing_context_do_not_credit_a_disclosure(self):
        for kw in [dict(max_words=1),dict(existing=self.f.bodies['root'])]:
            v=self.run_query('Tell me about scholars.',**kw);self.assertEqual(v['text'],'');self.assertEqual(v['state'],{})
    def test_another_context_cannot_reuse_a_previous_focus(self):
        a=self.run_query('Tell me about scholars.');self.f.reader.fingerprint='other-actor-context'
        self.assertEqual(self.run_query('Tell me more.',a['state'])['text'],'')
    def test_navigation_and_trace_identifiers_stay_outside_prose(self):
        v=self.run_query('Tell me about scholars.');self.assertNotIn('context-a',v['text']);self.assertNotIn('candidate',v['text']);self.assertTrue(v['trace'])
    def test_unknown_exhausted_and_already_present_are_distinct_delivery_states(self):
        first=self.run_query('How do scholars prepare a salve with clean water?',ids=['deep'])
        self.assertEqual(first['disclosure']['access'],'provided')
        self.assertEqual(self.run_query('Tell me more.',first['state'])['disclosure']['access'],'continuation')
        self.assertEqual(self.run_query('How do scholars prepare a salve with clean water?',ids=['deep'],existing=self.f.bodies['deep'])['disclosure']['access'],'existing')
        self.f.allowed.clear()
        self.assertEqual(self.run_query('Tell me about scholars.')['disclosure']['access'],'not_established')
    def test_local_custom_routes_preserve_geography_and_do_not_grant_access(self):
        with closing(self.f.connect())as c,c:c.execute('INSERT INTO edges VALUES(?,?,?)',('root','festival','has_local_custom'))
        v=self.run_query('Which festivals do scholars celebrate?',ids=['festival'])
        self.assertEqual([p['node_id']for p in v['passages']],['festival']);self.assertEqual(v['passages'][0]['heading'],'A Village — A Local Festival')
        self.f.allowed.remove('festival');self.assertEqual(self.run_query('Which festivals do scholars celebrate?',ids=['festival'])['text'],'')
    def test_co_mentions_do_not_count_as_parent_or_local_custom_links(self):
        with closing(self.f.connect())as c,c:c.execute('INSERT INTO edges VALUES(?,?,?)',('root','festival','co_mentioned'))
        self.assertEqual(self.run_query('Which festivals do scholars celebrate?',ids=['festival'])['text'],'')
    def test_grammatical_stopwords_are_not_character_name_anchors(self):
        with closing(self.f.connect())as c,c:
            c.execute('INSERT INTO aliases VALUES(?,?,?)',('An','other','name_alias'))
            c.execute('INSERT INTO aliases VALUES(?,?,?)',('salves','leaf','name_alias'))
        v=self.run_query('An account about salves',ids=['leaf'],semantic_ids=['leaf'])
        self.assertEqual([p['node_id']for p in v['passages']],['leaf'])
    def test_possessive_command_does_not_anchor_the_cosmological_order(self):
        from lorebook_disclosure import anchors
        with closing(self.f.connect())as c,c:c.execute('INSERT INTO aliases VALUES(?,?,?)',('Order','other','name_alias'))
        for query in ["A noble's order cannot break our apprenticeship contract. Who is right?",'Must I follow his order?','Can our order wait?']:
            self.assertNotIn('other',anchors(self.f,query))
        for query in ['Explain Order.','What is order?','His order can wait; tell me about Order.']:
            self.assertIn('other',anchors(self.f,query))
    def test_short_names_and_foreign_syllables_are_not_long_word_prefixes(self):
        with closing(self.f.connect())as c,c:c.execute('UPDATE passages SET title=?,text=? WHERE id=?',('Marasmius','A dormant mushroom listens.','other'))
        for query in ['Mara','dor']:
            self.assertEqual(self.run_query(query,ids=['other'])['text'],'')
    def test_one_incidental_word_does_not_trigger_an_unnamed_topic(self):
        self.assertEqual(self.run_query('Would you pass herbs while it rains?',ids=['leaf'])['text'],'')
    def test_blocked_best_match_cannot_hide_a_lower_ranked_qualified_account(self):
        self.f.allowed.remove('deep')
        v=self.run_query('clean water salve herbs',ids=['deep','leaf'])
        self.assertEqual([p['node_id']for p in v['passages']],['leaf'])
    def test_dated_base_accounts_also_require_an_explicit_bound_character_subject(self):
        self.f.reader.reference=types.SimpleNamespace(bindings={'bound-entry':'root'})
        self.f.reader.known={'root'}
        with closing(self.f.connect())as c,c:
            for node,entry in [('base-known','bound-entry'),('base-unbound','other-entry')]:
                self.f.rows.append((node,'Familiar Records',None,node,'The familiar records concern a public guild.'))
                self.f.bodies[node]='The familiar records concern a public guild.';self.f.allowed.add(node)
                c.execute('INSERT INTO nodes VALUES(?,?,?,?,?,?)',(node,node,'base','Familiar Records',None,node))
                c.execute('INSERT INTO passages VALUES(?,?,?,?,?,?,?,?,?)',(node,node,node,'base','Familiar Records',self.f.bodies[node],'hash',1,json.dumps({'entry_id':entry})))
        self.d=Disclosure(self.f)
        v=self.run_query('Explain familiar records',ids=['base-known','base-unbound'],semantic_ids=['base-unbound'])
        self.assertEqual([p['node_id']for p in v['passages']],['base-known'])
        self.assertTrue(any(x['status']=='outside_character_subject_scope'for x in v['trace']))
        self.f.reader.known=set()
        self.assertEqual(self.run_query('Explain familiar records',ids=['base-known'])['text'],'')
    def test_possessive_s_does_not_become_a_currency_alias(self):
        with closing(self.f.connect())as c,c:c.execute('INSERT INTO aliases VALUES(?,?,?)',('S','other','name_alias'))
        v=self.run_query("Explain scholars' herbal practice.",ids=['chapter'])
        self.assertEqual([p['node_id']for p in v['passages']],['chapter'])
    def test_semantic_candidates_do_not_turn_social_requests_into_book_topics(self):
        self.assertEqual(self.run_query('Please sit with me while it rains.',semantic_ids=['leaf'])['text'],'')
    def test_more_tea_and_weather_it_do_not_continue_an_old_book_topic(self):
        first=self.run_query('Tell me about scholars.')
        for query in ['More tea.','Would you pass the bread and sit with me while it rains?']:
            value=self.run_query(query,first['state'],semantic_ids=['leaf'])
            self.assertEqual(value['text'],'');self.assertEqual(value['disclosure']['access'],'not_requested')
    def test_reported_quantity_and_acknowledgements_do_not_advance_a_topic(self):
        first=self.run_query('Tell me about scholars.')
        for query in ['We have more scholars.','They have more scholars.','There are more scholars.','Yes.','It is so.']:
            value=self.run_query(query,first['state'],semantic_ids=['leaf'])
            self.assertEqual(value['passages'],[],query)
            self.assertEqual(value['disclosure']['access'],'not_requested',query)
            self.assertEqual(value['disclosure']['intent'],'none',query)
    def test_explicit_short_continuations_preserve_progression_intent(self):
        first=self.run_query('Tell me about scholars.')
        for query in ['More.','Go on.','Please continue.','Could you tell me more about scholars?','Say more about scholars.','More scholars.','And tell me more about scholars.']:
            value=self.run_query(query,first['state'])
            self.assertEqual(value['disclosure']['mode'],'deepen',query)
            self.assertEqual(value['disclosure']['intent'],'continue',query)
            self.assertEqual(value['passages'][0]['node_id'],'chapter',query)
    def test_comparative_more_questions_do_not_claim_to_advance_the_chapter(self):
        first=self.run_query('Tell me about scholars.')
        for query in ['Do scholars know more?','Why do scholars know more?','Tell me more about scholars politics.']:
            value=self.run_query(query,first['state'])
            self.assertNotEqual(value['disclosure']['mode'],'deepen',query)
            self.assertNotEqual(value['disclosure']['intent'],'continue',query)
    def test_exhausted_continuation_retains_intent_without_returning_a_new_body(self):
        value=self.run_query('Tell me about scholars.')
        for _ in range(8):
            if not value['passages']:break
            value=self.run_query('Tell me more.',value['state'])
        self.assertEqual(value['passages'],[])
        self.assertEqual(value['disclosure']['access'],'continuation')
        self.assertEqual(value['disclosure']['intent'],'continue')
    def test_missing_local_access_does_not_backfill_a_generic_semantic_people_chapter(self):
        place='expanded:place:001'
        self.f.rows=[(place if r[0]=='village'else r[0],r[1],place if r[2]=='village'else r[2],place if r[3]=='village'else r[3],r[4])for r in self.f.rows]
        self.f.bodies[place]=self.f.bodies.pop('village');self.f.allowed.add(place);self.f.allowed.remove('festival')
        with closing(self.f.connect())as c,c:
            c.execute('UPDATE nodes SET id=?,canonical_id=?,entry_node_id=? WHERE id=?',(place,place,place,'village'))
            c.execute('UPDATE nodes SET parent_id=?,entry_node_id=? WHERE id=?',(place,place,'festival'))
            c.execute('UPDATE passages SET node_id=?,entry_node_id=? WHERE node_id=?',(place,place,'village'))
            c.execute('UPDATE passages SET entry_node_id=? WHERE node_id=?',(place,'festival'))
            c.execute('UPDATE passages SET text=? WHERE id=?',('The scholars guild stores herbs for winter.','chapter'))
        self.d=Disclosure(self.f)
        for semantic in [False,True]:
            v=self.run_query('Which winter festivals do scholars observe in A Village?',ids=['festival','chapter'],semantic_ids=['festival','chapter'],
                             semantic_relevance=semantic,semantic_matches=[dict(id='chapter',score=.9),dict(id='festival',score=.8)] if semantic else [])
            self.assertEqual(v['text'],'')


if __name__=='__main__':unittest.main()
