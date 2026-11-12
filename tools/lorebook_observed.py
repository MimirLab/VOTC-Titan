"""Current-culture familiarity without inventing a user-reported campaign history.

Experimental host adapter, not enabled in the production worker. It uses the
unchanged accepted resolver and CampaignReader navigation but withdraws ALL
base/history reads. Only already-qualified common customs can be admitted.
"""
import copy,hashlib,json,re
from contextlib import closing
from datetime import date
from pathlib import Path

def encoded(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False)

def observed_reader(pack,context,bindings_file=None):
    from lorebank.campaign_lore import CampaignReader
    from lorebank.goa_reader import UNAVAILABLE
    from lorebank.manuscript_export import pin
    bindings_file=Path(bindings_file or Path(__file__).with_name('lorebook-observed-bindings.json'))
    policy=json.loads(bindings_file.read_text())
    if policy.get('version')!=1 or set(policy['allowedCategories'])!={'enduring_custom','belief_account','linguistic_convention'}:raise ValueError('Invalid observed knowledge policy')
    fields={'origin','campaign_id','timeline_id','actor_id','as_of','setting_sha256','culture_heritage'}
    if not isinstance(context,dict) or set(context) not in (fields,fields|{'culture_lineage'}) or context['origin']!='verified_current_culture':raise ValueError('Verified current culture context required')
    if any(not isinstance(context[k],str) or not context[k] or len(context[k])>256 for k in ['campaign_id','timeline_id','actor_id']):raise ValueError('Observed actor/campaign identity required')
    if not isinstance(context['as_of'],str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',context['as_of']):raise ValueError('Observed clock required')
    try:date.fromisoformat(context['as_of'])
    except ValueError:raise ValueError('Invalid observed clock') from None
    if context['setting_sha256']!=pin(pack.reference.path)['sha256']:raise ValueError('Observed setting edition differs')
    matches=[r for r in policy['bindings'] if encoded(r['heritageFact'])==encoded(context['culture_heritage'])]
    if len(matches)>1:raise ValueError('Ambiguous cultural heritage definition')
    selected=matches[0] if matches and matches[0]['observedCultureDefinitions'] else None
    lineage=context.get('culture_lineage',[])
    if not isinstance(lineage,list) or len(lineage)>4096:raise ValueError('Invalid observed culture lineage')
    if any(not isinstance(f,dict) or set(f)!={'kind','key','category','name','description','rules'} or f['kind']!='lineage' or
           any(not isinstance(v,str) or len(v)>65536 for v in f.values()) for f in lineage):raise ValueError('Invalid observed culture lineage')
    if len({f['key'] for f in lineage})!=len(lineage):raise ValueError('Duplicate observed culture lineage')
    bindings=policy.get('lineageBindings',[])
    if not isinstance(bindings,list):raise ValueError('Invalid observed culture lineage policy')
    lineage_matches=[r for r in bindings if any(encoded(r['lineageFact'])==encoded(f) for f in lineage)]
    subjects=sorted(set(([selected['subjectId']] if selected else [])+[subject for r in lineage_matches for subject in r['subjectIds']]))
    if not subjects:raise ValueError('Unmapped or changed cultural heritage definition')

    class ObservedCommonReader(CampaignReader):
        def __init__(self):
            self.upstream=pack.reference.upstream;self.reference=pack.reference;self.mode='history'
            self.state={**copy.deepcopy(context),'lore_knowledge':{'actor_id':context['actor_id'],'as_of':context['as_of'],
                'setting_sha256':context['setting_sha256'],'known_subjects':subjects}}
            self.known=frozenset(self.subject(subject) for subject in subjects)
            self._observation=encoded(self.state)
            self.fingerprint=hashlib.sha256(encoded({'observed':self.state,'reference':self.reference.fingerprint,'policy':hashlib.sha256(bindings_file.read_bytes()).hexdigest()}).encode()).hexdigest()
            # The accepted reference returns an owned context manager, not a
            # raw SQLite connection; its exit already closes that connection.
            with self.reference.connect() as c:
                self.nodes={r['id']:dict(r) for r in c.execute('SELECT * FROM nodes')}
                self.policies={r['node_id']:dict(r) for r in c.execute('SELECT * FROM knowledge_policies')}
                links=[dict(r) for r in c.execute('SELECT * FROM child_links')]
            self.children={};self.linked={}
            for n in sorted(self.nodes.values(),key=lambda n:(n['position'],n['id'])):self.children.setdefault(n['parent_id'],[]).append(n['id'])
            for link in sorted(links,key=lambda x:(x['position'],x['target_id'])):self.linked.setdefault(link['parent_id'],[]).append(link['target_id'])
            self.admitted=set()
            for nid,p in self.policies.items():
                if p['text_sha256']!=hashlib.sha256(self.nodes[nid]['text'].encode()).hexdigest():raise ValueError('Observed policy body changed')
                if p['category'] in policy['allowedCategories'] and p['eligibility']=='reported_subject_knowledge' and set(json.loads(p['scopes_json']))<=self.known:self.admitted.add(nid)
            self.navigation=set(self.admitted)
            changed=True
            while changed:
                before=len(self.navigation)
                for nid in list(self.navigation):
                    parent=self.nodes[nid]['parent_id']
                    if parent:self.navigation.add(parent)
                for parent,kids in self.linked.items():
                    if any(x in self.navigation for x in kids):self.navigation.add(parent)
                changed=before!=len(self.navigation)
        def _check_context(self):
            if encoded(self.state)!=self._observation:raise ValueError('Observed context changed; restart the reader')
        def _prior(self,ident):return None
        def _base_for(self,rid):return None
        def named_subjects(self,query):
            # Only explicitly reviewed source-specific aliases route a named
            # culture. Broad heritage mappings are knowledge, not name aliases.
            text=' '.join(re.findall(r'\w+',query.casefold()))
            matches=[]
            for row in lineage_matches:
                for alias in row.get('queryAliases',[]):
                    if re.search(r'(?<!\w)'+re.escape(alias.casefold())+r'(?!\w)',text):
                        matches.extend(row['subjectIds'])
            with closing(pack.bundle.connect()) as db:
                roots=[r[0] for subject in dict.fromkeys(matches) for r in db.execute(
                    'SELECT entry_node_id FROM nodes WHERE id=?',(subject,)) if r[0]]
                if not roots and re.search(r'\b(?:your|our|my)\s+(?:people|culture|clan|kin|community|traditions)\b',query,re.I):
                    # A personal cultural question can name the topic rather
                    # than the parent culture. Resolve it only when exactly
                    # one qualified parent has a distinctive literal match.
                    from lorebook_disclosure import query_words,words
                    specific=query_words(query)-{'people','culture','clan','kin','community','tradition','custom','care','family'}
                    ids=self.candidate_ids(query)
                    if specific and ids:
                        slots=','.join('?' for _ in ids)
                        qualified={r['subjectId'] for r in ([selected] if selected else [])}
                        qualified.update(subject for r in lineage_matches for subject in r['subjectIds'])
                        allowed={row[0] for subject in qualified for row in db.execute('SELECT entry_node_id FROM nodes WHERE id=?',(subject,))}
                        rows=db.execute('SELECT entry_node_id,text FROM passages WHERE id IN ('+slots+')',ids)
                        for row in rows:
                            body=words(row[1])
                            if row[0] in allowed and any(a==b or (min(len(a),len(b))>=5 and (a.startswith(b) or b.startswith(a))) for a in specific for b in body):
                                roots.append(row[0])
                        roots=list(dict.fromkeys(roots))
                        if len(roots)!=1:roots=[]
            return list(dict.fromkeys(roots))[:2]
        def candidate_ids(self,query):
            # Search inside already-qualified common lore first; a large base
            # corpus must not crowd out a relevant inherited custom. Disclosure
            # still checks relevance, named subjects, and source permissions.
            stop={'the','and','you','your','our','was','were','what','when','where','how','why','tell','about','have','has','this','that','with','for','their'}
            terms=[t for t in re.findall(r'\w+',query)[:40] if len(t)>2 and t.casefold() not in stop]
            if not terms or not self.admitted:return []
            expression=' OR '.join('"'+t+'"*' for t in terms[:20])
            ids=sorted(self.admitted)
            with closing(pack.bundle.connect()) as db:
                slots=','.join('?' for _ in ids)
                return [r[0] for r in db.execute('SELECT p.id FROM lexical l JOIN passages p ON p.id=l.passage_id '
                    'WHERE lexical MATCH ? AND p.family=? AND p.node_id IN ('+slots+') '
                    'ORDER BY bm25(lexical,0,8,1),p.id LIMIT 20',(expression,'expanded',*ids))]
        def read(self,node_id,cursor=None):
            self._check_context()
            nid=self._expanded(node_id)
            if nid not in self.navigation:raise ValueError(UNAVAILABLE)
            return super().read(node_id,cursor)

    return ObservedCommonReader()


def combined_reader(pack,reported,common):
    """Join independently validated knowledge without widening either source.

    The report alone supplies historical/base subject permission. The live
    culture contributes only its already-qualified expanded common accounts.
    Pagination and the fingerprint bind the combination to both observations.
    """
    from lorebank.goa_reader import UNAVAILABLE
    from lorebook_campaign_clock import bind_campaign_clock
    if not isinstance(reported,dict) or not isinstance(common,dict):raise ValueError('Both knowledge contexts are required')
    knowledge=reported.get('lore_knowledge')
    if not isinstance(knowledge,dict) or any(reported.get(k)!=common.get(k) for k in ['campaign_id','timeline_id','as_of']) or \
            knowledge.get('actor_id')!=common.get('actor_id') or knowledge.get('setting_sha256')!=common.get('setting_sha256'):
        raise ValueError('Reported and observed knowledge belong to different actors, campaigns, clocks or editions')
    primary=bind_campaign_clock(pack.reader(state=reported))
    secondary=observed_reader(pack,common)

    class CombinedReader:
        def __init__(self):
            self.reference=primary.reference;self.upstream=primary.upstream;self.mode='history'
            # Never let cultural familiarity grant the report's historical
            # subject or base-annals permissions.
            self.known=primary.known;self.admitted=primary.admitted|secondary.admitted
            self.policies=primary.policies;self.state=copy.deepcopy(primary.state)
            self._binding=encoded(self.state)
            self.fingerprint=hashlib.sha256(encoded({'report':primary.fingerprint,'observed':secondary.fingerprint}).encode()).hexdigest()

        def _check_context(self):
            if encoded(self.state)!=self._binding:raise ValueError('Combined knowledge changed; restart the reader')
            primary._check_context();secondary._check_context()

        def candidate_ids(self,query):return secondary.candidate_ids(query)
        def named_subjects(self,query):return secondary.named_subjects(query)

        def read(self,node_id,cursor=None):
            self._check_context()
            values=[]
            for reader in [primary,secondary]:
                try:first=reader.read(node_id)
                except ValueError as exc:
                    if str(exc)!=UNAVAILABLE:raise
                    continue
                children=list(first.get('children',[]));related=list(first.get('related',[]));next_cursor=first.get('next_cursor');seen=set()
                while next_cursor:
                    if next_cursor in seen or len(children)>4096:raise ValueError('Invalid combined knowledge navigation')
                    seen.add(next_cursor);page=reader.read(node_id,next_cursor);children.extend(page.get('children',[]));next_cursor=page.get('next_cursor')
                values.append((reader,first,children,related))
            if not values:raise ValueError(UNAVAILABLE)
            # A report can navigate a baseline subject even without reporting
            # that subject as known. An independently observed common custom
            # must not thereby promote that subject's historical overview.
            observed=next((v for v in values if v[0] is secondary),None)
            nid=secondary._expanded(node_id);seen=set();subject=None
            while nid in secondary.nodes and nid not in seen:
                seen.add(nid)
                if nid in secondary.reference.records:subject=nid;break
                nid=secondary.nodes[nid]['parent_id']
            common_only=bool(observed and subject in secondary.known and subject not in primary.known)
            if common_only:
                ordered=[observed]+[v for v in values if v[0] is not secondary]
            else:ordered=values
            chosen=copy.deepcopy(ordered[0][1]);children={};related={}
            for reader,_first,items,links in ordered:
                if common_only and reader is primary:
                    # Explicitly selected report turnings remain navigable;
                    # ordinary historical children are not granted by culture.
                    items=[item for item in items if item['node_id'] in primary.upstream.active]
                    links=[]
                for item in items:children.setdefault(item['node_id'],item)
                for item in links:related.setdefault(item['node_id'],item)
            children=list(children.values());binding='combined-read:'+node_id
            offset=self.reference.__class__.position(self,cursor,binding)
            chosen['children']=copy.deepcopy(children[offset:offset+10]);chosen['related']=copy.deepcopy(list(related.values())[:10])
            chosen['next_cursor']=self.reference.__class__.cursor(self,offset+10,binding) if len(children)>offset+10 else None
            return chosen

    return CombinedReader()
