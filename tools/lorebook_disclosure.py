"""Bounded hierarchical delivery over the immutable, accepted Chronicle reader.

Only the accepted resolver's bodies and context-visible ancestor titles become
prose. Catalogue/graph matches rank candidates; they never grant knowledge.
"""
import hashlib
import json
import re
import unicodedata
import math
from contextlib import closing,contextmanager

VERSION = 'titan-progressive-lore-v2'
STOP = set('a an the i you we they he she it my your our his her their and or of to in is are was were be do does did can could would should will have has had for with that this what when where how why which tell about me please say explain describe teach discuss advise give know facts information both them those these more further details detail deeper continue elaborate overview introduction general also then go on next happened came so'.split())
STOP.update('if am as at by but not no yes who may might must than until while now'.split())
DEEPEN = re.compile(r'\b(more|further|detail(?:s)?|deeper|continue|elaborate)\b|\bgo on\b|\bwhat (?:happened|came) next\b', re.I)
ADVANCE_REQUEST = re.compile(r'^\s*["“]*(?:(?:and|then)[\s,]+)?(?:please[\s,]+)?(?:more(?:\s+(?:about|on)\b.*)?|(?:continue|elaborate|go on)(?:\s+(?:about|on|with)\b.*)?|(?:further details|deeper)(?:\s+(?:about|on)\b.*)?)[.!?"”\s]*$',re.I)
ADVANCE_INQUIRY = re.compile(r'^\s*["“]*(?:(?:and|then)[\s,]+)?(?:please[\s,]+)?(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?(?:tell(?:\s+me)?|say|explain|describe|teach\s+me|show\s+me|give\s+me)\b[^.!?]{0,300}\b(?:more|further|details?|deeper)\b|^\s*["“]*(?:and\s+)?what\s+(?:happened|came)\s+next\b',re.I)
INQUIRY = re.compile(r'\b(who|what|where|when|why|how|which|tell|explain|describe|teach|discuss|about|advise|compare|contrast)\b', re.I)
DEFER = re.compile(r'\b(?:rules?|lore|history|customs?|lessons?|stories|accounts?|details?|that|this)\s+(?:can|could|will)\s+wait\b|\b(?:we|i|you)\s+(?:can|could|will|shall)\s+(?:talk|discuss|learn|explain|hear)\b[^.!?;,]{0,120}\b(?:later|tomorrow|another time)\b', re.I)
SCENE_PAUSE = re.compile(r'\b(?:can|could|will)\s+wait\b|\b(?:just|only)\s+(?:sit|stay|listen|wait|be|hold)\b', re.I)
QUIET_COMPANY = re.compile(r'\b(?:need|want)\s+(?:only\s+)?(?:your\s+)?(?:company|quiet|silence)\b|\b(?:hold|take)\b[^.!?;]{0,50}\b(?:in\s+silence|silently)\b|\b(?:quiet|silent)\s+company\b',re.I)
CONTEXT_TOPICS={
    'editorial-node_f579b752ca179d01d7b07be3':'The Light',
    'editorial-node_769aa1e2cbc189ed383e7cba':'Coinage and Payment',
}
INFORMATION_CLAUSE = re.compile(r'^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+)?(?:tell|explain|describe|teach|discuss|compare|contrast)\b|^(?:and\s+)?(?:who|what|where|when|why|how|which)\b',re.I)
POSTPONE_STATEMENT = re.compile(r'\b(?:can|could|will)\s+(?:keep|save|leave)\b[^.!?;,]{0,100}\b(?:for\s+(?:another|some\s+other)\s+day|for\s+tomorrow|until\s+later)\b',re.I)

def deferred_clause(clause):
    return bool(DEFER.search(clause)or('?'not in clause and not INFORMATION_CLAUSE.search(clause.strip())and POSTPONE_STATEMENT.search(clause)))

def quiet_company_request(query):
    clauses=re.split(r'(?<=[.!?;,])\s+|\s+but\s+',query,flags=re.I)
    if not(SCENE_PAUSE.search(query)or QUIET_COMPANY.search(query)or any(deferred_clause(c)for c in clauses)):return False
    return not any(INFORMATION_CLAUSE.search(re.sub(r'^[\w-]+,\s*','',clause.strip())) for clause in clauses)

def reported_resolution(reader, node_id, text):
    """Preserve an admitted coded resolution's exact report, never infer an outcome from an option ID."""
    upstream=reader.upstream
    if getattr(upstream,'mode',None)!='history':return None
    branch=upstream.active.get(node_id)
    if not branch or branch.get('kind')!='coded_resolution':return None
    matches=[choice for choice in upstream.state['choices'] if choice['branch_id']==node_id]
    if len(matches)!=1:return None
    choice=matches[0];resolution=choice.get('guard_evidence',{}).get('resolution')
    if not isinstance(resolution,str)or not resolution.strip()or len(resolution)>1000:return None
    definition=json.loads(branch['evidence_json'])['source']['block_sha256']
    if choice['definition_sha256']!=definition:raise ValueError('Resolution definition binding changed')
    return dict(kind='reported_campaign_resolution',branch_id=node_id,definition_sha256=definition,
                occurred_at=choice['occurred_at'],resolution=resolution,origin=upstream.state['origin'],
                body_sha256=hashlib.sha256(text.encode()).hexdigest())


def active_query(query):
    """Exclude explicitly postponed discussion; retain a separate current request."""
    return ' '.join(clause for clause in re.split(r'(?<=[.!?;,])\s+|\s+but\s+',query,flags=re.I) if not deferred_clause(clause))


def elliptic_followup(query):
    return bool(re.match(r'^\s*(?:and\s+)?(?:if\b|what\s+(?:happens\s+)?if\b|why\b)',query,re.I))


def words(text):
    def stem(t):
        t=t.casefold()
        return t[:-1] if len(t)>4 and t.endswith('s') and not t.endswith('ss') else t
    return {stem(t) for t in re.findall(r'\w+', text) if len(t) > 2 and t.casefold() not in STOP and stem(t) not in STOP}


def query_words(text):
    """A few explicit religious terms name the faith topic, never an access grant.

    An ancient account can mention followers before the Holy Light; literal
    overlap alone must not beat the faith chapter for present worship questions.
    Historical words and titles retain their ordinary ranking weight.
    """
    result=words(text)
    if re.search(r'\b(?:holy\s+light|faith|religio(?:n|us)|worship\w*|clergy|cleric\w*|priest\w*|paladin\w*|miracle\w*)\b',text,re.I):result.add('faith')
    return result


def normalize(text):
    return ' '.join(re.findall(r'[^\W_]+', unicodedata.normalize('NFKC',text).casefold()))


def refers_back(query):
    return bool(re.search(r'\b(their|they|them|those)\b',query,re.I)or
                (re.search(r'\b(it|that)\b',query,re.I)and len(words(query))<=1))


def anchors(pack, query, contextual_topics=False):
    tokens = re.findall(r'\w+', query)[:40]
    phrases = {' '.join(tokens[i:i+n]).casefold() for n in range(1, min(8, len(tokens))+1) for i in range(len(tokens)-n+1)
               if any(len(t)>1 and t.casefold()not in STOP for t in tokens[i:i+n])}
    # A possessive command ("a noble's order", "his order") is not the
    # cosmological proper name Order. Keep explicit names and every other
    # occurrence; this changes topic routing, never reader permissions.
    order_mentions=list(re.finditer(r'\border\b',query,re.I))
    if order_mentions and all(m.group()=='order' and re.search(r"\b(?:my|your|his|her|their|our|its|\w+['’]s)\s+$",query[:m.start()],re.I) for m in order_mentions):
        phrases.discard('order')
    if not phrases:
        return []
    with closing(pack.bundle.connect()) as c:
        slots=','.join('?'for _ in phrases)
        # An exact, unique composed section title (Lakeshire under Redridge)
        # can focus navigation without inventing an identity alias or a grant.
        # Repeated generic chapter titles are deliberately excluded.
        rows = c.execute('SELECT root,max(width)width FROM (SELECT n.entry_node_id root,length(a.name)width FROM aliases a JOIN nodes n ON n.id=a.target_id WHERE lower(a.name) IN ('+slots+') AND a.kind!=? UNION ALL SELECT entry_node_id root,length(title)width FROM nodes WHERE family=? AND id LIKE ? AND lower(title)IN('+slots+') AND lower(title) IN (SELECT lower(title) FROM nodes WHERE family=? GROUP BY lower(title) HAVING count(DISTINCT entry_node_id)=1)) GROUP BY root ORDER BY width DESC,root LIMIT ?', (*sorted(phrases),'context_route','expanded','expanded:place:%',*sorted(phrases),'expanded',2+len(CONTEXT_TOPICS) if contextual_topics else 2)).fetchall()
        result=[]
        for row in rows:
            root=row['root'];soft=False
            # These inspected abstract topics are routing roles, never grants
            # or equivalences between identities. Bind the role to its exact
            # canonical catalogue row; unknown/changed editions stay strict.
            if contextual_topics and root in CONTEXT_TOPICS:
                node=c.execute('SELECT * FROM nodes WHERE id=?',(root,)).fetchone()
                if node and node['family']=='base' and node['canonical_id']==root and node['parent_id'] is None and node['title']==CONTEXT_TOPICS[root]:
                    if node['title']=='The Light':
                        soft=bool(re.search(r'\b(?:your|our|this)\s+(?:neighbou?rs|community|people|culture|town|village|faith)\b',query,re.I))
                    else:
                        mentions=list(re.finditer(r'\bcoins?\b',query,re.I))
                        soft=bool(mentions) and all(m.group()==m.group().lower() for m in mentions) and len(tokens)>5 and 'coinage and payment' not in normalize(query)
            if not soft:result.append(root)
    return result[:2]


def focus_query(query, previous, current_anchors):
    # Pronoun-only continuation may use an already context-bound subject. New
    # named subjects always outrank previous focus; "more tea" is not "more".
    if previous and not current_anchors and (not words(query) or refers_back(query) or elliptic_followup(query)):
        return query + ' ' + str(previous.get('focus_title', ''))[:160]
    return query


def context_only_advance(query, previous):
    """A contextual offer is not an informational exchange or proof of speech."""
    return bool(previous and previous.get('focus_origin')=='scene' and ADVANCE_REQUEST.match(query)
                and not INQUIRY.search(query) and not query_words(query))


class ResolverPhase:
    """Execute the identical accepted resolver with owned connection lifetime."""
    def __init__(self,bundle):self.bundle=bundle
    def __getattr__(self,name):return getattr(self.bundle,name)
    @contextmanager
    def connect(self):
        with closing(self.bundle.connect())as connection:yield connection
    def resolve(self,*args,**kwargs):
        method=self.bundle.resolve
        if getattr(method,'__self__',None)is self.bundle:
            return method.__func__(self,*args,**kwargs)
        return method(*args,**kwargs) # structural fixture delegate


class Disclosure:
    def __init__(self, pack):
        self.pack = pack
        with closing(pack.bundle.connect()) as c:
            self.nodes = {r['id']: dict(r) for r in c.execute('SELECT * FROM nodes')}
        self.canonical = {}
        for n in self.nodes.values():
            self.canonical.setdefault(n['canonical_id'], []).append(n['id'])

    def path(self, node):
        start = self.nodes.get(node)
        if not start:
            return []
        root = start['entry_node_id']; result = []; seen = set()
        while node in self.nodes and node not in seen and len(result) < 12:
            seen.add(node); n = self.nodes[node]; result.append(node)
            if n['id'] == root or n['canonical_id'] == root:
                return list(reversed(result))
            node = n['parent_id']
        return list(reversed(result)) if result and not self.nodes[result[-1]]['parent_id'] else []

    def deliver(self, reader, query, candidate_ids, previous=None, max_words=350, existing='', semantic_ids=(), max_accounts=3, prior_subjects=(), automatic=True, recall_current=False, scene_relevance=False, semantic_relevance=False, semantic_matches=(),semantic_complete=False):
        if type(automatic)is not bool:raise ValueError('Invalid retrieval origin')
        if type(recall_current)is not bool:raise ValueError('Invalid current-account recall')
        if type(scene_relevance)is not bool:raise ValueError('Invalid scene relevance control')
        if type(semantic_relevance)is not bool:raise ValueError('Invalid semantic relevance control')
        if type(semantic_complete)is not bool:raise ValueError('Invalid semantic score coverage')
        if not isinstance(semantic_matches,(list,tuple)) or len(semantic_matches)>64:raise ValueError('Invalid scored semantic matches')
        scored={}
        for value in semantic_matches:
            if not isinstance(value,dict) or set(value)!={'id','score'} or not isinstance(value['id'],str) or (not semantic_complete and value['id'] not in candidate_ids) or value['id'] in scored or type(value['score'])not in(int,float) or not math.isfinite(value['score']) or not -1<=value['score']<=1:
                raise ValueError('Invalid scored semantic matches')
            scored[value['id']]=value['score']
        if type(max_words) is not int or not 1 <= max_words <= 2000:
            raise ValueError('Invalid disclosure budget')
        if type(max_accounts) is not int or not 1 <= max_accounts <= 3:
            raise ValueError('Invalid disclosure account limit')
        if not isinstance(prior_subjects,(list,tuple)) or len(prior_subjects)>2 or any(not isinstance(root,str)or root not in self.nodes for root in prior_subjects):
            raise ValueError('Invalid cumulative disclosure subjects')
        if not isinstance(candidate_ids, list) or len(candidate_ids) > 100 or any(not isinstance(x, str) for x in candidate_ids):
            raise ValueError('Invalid disclosure candidates')
        if not isinstance(previous, dict) or previous.get('version') != VERSION or previous.get('context') != reader.fingerprint or not isinstance(previous.get('shown'),list):
            previous = {}
        if semantic_relevance and automatic and quiet_company_request(query):
            return dict(text='',passages=[],trace=[dict(status='current_request_is_quiet_company')],words=0,
                        actor_id=reader.state['lore_knowledge']['actor_id'],context_fingerprint=reader.fingerprint,
                        disclosure=dict(version=VERSION,mode='empty',probes=0,access='not_requested',intent='none'),state={})
        if automatic:query=active_query(query)
        named = anchors(self.pack, query,contextual_topics=semantic_relevance)
        if hasattr(reader, 'named_turnings'):
            named = reader.named_turnings(query) or named
        terms = query_words(query)
        shorthand=bool(terms or named)and len(re.findall(r'\w+',query))<=4 and not re.search(r'\b(i|you|we|me|us|my|your|our|am|is|are|was|were|have|has|had|do|does|did)\b',query,re.I)
        direct_inquiry=bool(re.search(r'\b(who|what|where|when|why|how|which|tell|explain|describe|teach|discuss|advise|compare|contrast)\b',query,re.I))
        direct_inquiry=direct_inquiry or bool(re.search(r'\b(?:give|show)(?:\s+\w+){0,3}\s+(?:facts|information|details|account|overview)\b',query,re.I))
        explicit_more=bool(DEEPEN.search(query))and(shorthand or bool(ADVANCE_REQUEST.match(query))or bool(ADVANCE_INQUIRY.search(query)))
        more=bool(DEEPEN.search(query))if not automatic else explicit_more
        carry = bool(previous and (not named or previous.get('root') in named))
        follow = carry and ((more and (not terms or bool(named))) or not terms or refers_back(query) or (not named and elliptic_followup(query)))
        wanted = named or ([previous['root']] if follow and previous.get('root') in self.nodes else [])
        places={root for root in wanted if any(node.startswith('expanded:place:') for node in [root]+self.canonical.get(root,[]))}
        comparison=bool(re.search(r'\b(compare|contrast|difference|differences|between|versus|unlike)\b',query,re.I))
        if comparison:terms-=words('compare contrast difference differences between versus unlike')
        multipart=len(wanted)==1 and bool(re.search(r'\bboth\b.+\band\b',query,re.I))
        inquiry = bool(INQUIRY.search(query))
        requested=bool(query.strip())and(direct_inquiry or comparison or more or (carry and elliptic_followup(query))or '?'in query or shorthand)
        if automatic and context_only_advance(query,previous):
            return dict(text='',passages=[],trace=[dict(status='contextual_scene_continuation')],words=0,
                        actor_id=reader.state['lore_knowledge']['actor_id'],context_fingerprint=reader.fingerprint,
                        disclosure=dict(version=VERSION,mode='scene_continue',probes=0,access='not_requested',intent='none'),state=previous)
        scene=scene_relevance and automatic and not requested and bool(query.strip()) and not SCENE_PAUSE.search(query)
        if automatic and not requested and not scene:
            return dict(text='',passages=[],trace=[dict(status='query_not_requested')],words=0,
                        actor_id=reader.state['lore_knowledge']['actor_id'],context_fingerprint=reader.fingerprint,
                        disclosure=dict(version=VERSION,mode='empty',probes=0,access='not_requested',intent='none'),state={})
        if not scene and not named and not follow and not inquiry and len(re.findall(r'\w+',query))>5:candidate_ids=[]
        if DEEPEN.search(query) and terms and not named and not follow and not inquiry:candidate_ids=[]
        if not terms and not named and not follow:candidate_ids=[]
        trace = []; nav = {}; guarded = {}; attempts = 0
        def visible(node):
            if node not in nav:
                try: nav[node] = reader.read(node)
                except ValueError: nav[node] = None
            return nav[node]
        def admit(ident):
            nonlocal attempts
            if ident in guarded: return guarded[ident]
            if attempts >= 64: return None
            attempts += 1
            # CampaignReader dates the reference edition, but its base accounts
            # are not all actor knowledge. Titan adds a stricter NPC scope: only
            # reviewed entry-to-subject bindings with an explicit grant qualify.
            # This never changes the accepted reader or admits additional bodies.
            with closing(self.pack.bundle.connect())as scope_db:
                source=scope_db.execute('SELECT family,selector_json FROM passages WHERE id=?',(ident,)).fetchone()
            if source and source['family']=='base':
                subject=reader.reference.bindings.get(json.loads(source['selector_json'])['entry_id'])
                if subject not in reader.known:
                    trace.append(dict(candidate=ident,status='outside_character_subject_scope'))
                    guarded[ident]=None
                    return None
            value = ResolverPhase(self.pack.bundle).resolve([ident], reader, max_words=2000)
            trace.extend(value['trace']); guarded[ident] = value['passages'][0] if value['passages'] else None
            return guarded[ident]
        with closing(self.pack.bundle.connect()) as c:
            root_words=set().union(*(words(visible(root)['title']) for root in wanted if visible(root))) if wanted else set()
            if hasattr(reader, 'named_turnings') and reader.named_turnings(query):
                # Topic expansion (paladin -> faith, for example) belongs to
                # this exact named account too. It must not become a phantom
                # additional facet that filters the title out of its own read.
                root_words.update(query_words(' '.join(visible(root)['title'] for root in wanted if visible(root))))
            if wanted:
                normalized_query=' '+normalize(query)+' '
                rows=c.execute('SELECT a.name FROM aliases a JOIN nodes n ON n.id=a.target_id WHERE n.entry_node_id IN ('+','.join('?'for _ in wanted)+') AND a.kind!=?',(*wanted,'context_route'))
                for alias in rows:
                    if ' '+normalize(alias['name'])+' ' in normalized_query:root_words.update(words(alias['name']))
            topical_terms=terms-root_words
            generic = not (topical_terms if wanted else terms)
            if follow and more and re.search(r'\b(?:that|this|the)\s+(?:custom|practice|tradition|account|topic|subject)\b',query,re.I) and topical_terms<=words('custom practice tradition account topic subject'):
                generic=True
            def rows_for(node):
                ids = [node] + self.canonical.get(node, [])
                rows = c.execute('SELECT * FROM passages WHERE node_id IN ('+','.join('?' for _ in ids)+') ORDER BY CASE family WHEN ? THEN 0 ELSE 1 END,id', (*ids, 'expanded')).fetchall()
                # Do not spend the budget probing archived variants of a node;
                # the original resolver still validates the selected candidate.
                out = []
                for row in rows:
                    if row['family'] == 'base':
                        selector = json.loads(row['selector_json'])
                        with reader.upstream.base.snapshot() as snap:
                            chosen = reader.upstream.base.chosen(snap, row['node_id'])
                        if not chosen or chosen['id'] != selector['passage_id']: continue
                    out.append(dict(row))
                return out
            def node_body(node):
                for row in rows_for(node):
                    body = admit(row['id'])
                    if body: return row, body
                return None
            def children(node):
                value = visible(node)
                if not value: return []
                result = list(value['children']); cursor = value.get('next_cursor')
                if cursor:
                    result.extend(reader.read(node, cursor)['children'])
                return [x['node_id'] for x in result][:20]
            candidates = [];semantic_pool=[]
            literal_ids=set(candidate_ids)
            for rank, ident in enumerate(dict.fromkeys(candidate_ids+(list(scored)if semantic_relevance else[]))):
                row = c.execute('SELECT * FROM passages WHERE id=?', (ident,)).fetchone()
                if not row or not row['embed']: continue
                row = dict(row); path = self.path(row['node_id'])
                if not path: continue
                if row['family']=='base' and reader.reference.bindings.get(json.loads(row['selector_json'])['entry_id'])not in reader.known:
                    trace.append(dict(candidate=row['id'],status='outside_character_subject_scope'));continue
                topic_root=row['entry_node_id']
                # An explicitly named place narrows the question. If its local
                # account is withheld, a generic people chapter is no substitute
                # merely because both mention winter or trade.
                if wanted and topic_root not in wanted:
                    if row['family']=='goa':
                        branch=reader.upstream.active.get(json.loads(row['selector_json']).get('branch_id'))
                        entries=(reader.turning_entry_ids(branch['id']) if hasattr(reader,'turning_entry_ids') else json.loads(branch['entry_ids_json'])) if branch else []
                        affected=[root for eid in entries for root in [reader.reference.roots[eid]['root_id'],reader.reference.bindings.get(eid)] if root]
                        matching=[root for root in wanted if root in affected]
                        if not matching:continue
                        topic_root=matching[0]
                    elif row['family']=='expanded':
                        # A people's local custom can live under its geographic
                        # chapter. This qualified attachment is a route, never
                        # identity equivalence or a knowledge grant. The original
                        # resolver still requires BOTH knowledge scopes.
                        sources=set(wanted)
                        for root in wanted:sources.update(self.canonical.get(root,[]))
                        linked=c.execute('SELECT 1 FROM edges WHERE source_id IN ('+','.join('?'for _ in sources)+') AND target_id=? AND relation IN (?,?) LIMIT 1',(*sorted(sources),row['node_id'],'has_local_custom','has_custom_account')).fetchone()
                        if not linked:continue
                    else:continue
                if places and not comparison and topic_root not in places:continue
                row['_topic_root']=topic_root
                # Lexical relevance and semantic recall stay distinct signals.
                title_words = words(row['title']); body_words = words(row['text'])
                # Short ordinary names/syllables are not prefixes of unrelated
                # names or prose (Mara != Marasmius; dor != dormant).
                matched = {t for t in (topical_terms or terms) if any(v==t or (min(len(v),len(t))>=5 and (v.startswith(t) or t.startswith(v))) for v in title_words | body_words)}
                hits = len(matched);row['_query_hits']=matched
                if semantic_relevance and ident in scored and row['family']=='expanded':
                    semantic_pool.append((scored[ident],rank,row,path))
                if ident not in literal_ids:continue
                # Scene narration is an optional recall signal, never a grant.
                # Require stronger literal relevance than an explicit inquiry;
                # accepted resolver/ancestor checks still own every body.
                if scene and (row['family']!='expanded' or hits<3):continue
                # A chapter's named topic is stronger than an incidental mention
                # in its prose, including mentions that describe an earlier era.
                score = hits * 4 + len(title_words & terms) * 8 + 1/(rank+1)
                if follow and not named and hits and row['node_id']==previous.get('focus'):score+=8
                if (topical_terms or (terms and not named)) and not hits and ident not in semantic_ids: continue
                if not wanted and not follow and len(terms)>1 and hits<2:continue
                if len(wanted)>1 and not hits and topic_root!=wanted[0]:continue
                candidates.append((score, rank, row, path))
            candidates.sort(key=lambda x: (-x[0], x[1], x[2]['id']))
            semantic_pool.sort(key=lambda x:(-x[0],x[1],x[2]['id']))
            semantic_choice=None
            first=None;runner=-1 if semantic_complete else .25
            for similarity,rank,row,path in semantic_pool:
                if first is None and similarity<.25:break
                if first is not None and first[0]-similarity>=.04-1e-9:break
                body=admit(row['id'])
                if body and all(visible(node) is not None for node in path):
                    if first is None:first=(similarity,rank,row,path,body)
                    else:runner=max(runner,similarity);break
            if first:
                if first[0]-runner>=.04-1e-9:semantic_choice=first
                else:trace.append(dict(status='semantic_relevance_ambiguous'))
            selection = []; mode = 'scene' if scene else 'focused'; seen = set(previous.get('shown', [])[:32]);semantic_context=False
            if scene:max_accounts=min(max_accounts,1)
            # A writer seeing scene context has not thereby explained it. The
            # first explicit request re-resolves that account before descending.
            scene_reoffer=automatic and previous.get('focus_origin')=='scene' and follow and more and generic
            if scene_reoffer:
                value=node_body(previous['focus'])
                if value:selection.append((*value,self.path(value[0]['node_id'])))
            if follow and generic and not more:
                value=node_body(previous['focus'])
                if value:selection.append((*value,self.path(value[0]['node_id'])))
            # A generic continuation walks available children of the active
            # chapter, then its siblings, without spreading to another subject.
            if follow and more and generic and not scene_reoffer:
                mode = 'deepen'
                focus = previous.get('focus')
                expansion = children(focus) if focus in self.nodes else []
                boundary = previous.get('boundary', previous['root'] if previous.get('broad') else focus)
                branch = self.path(focus)
                # Finish the active subtree before moving to the next chapter.
                # A directly focused account sets its own disclosure boundary.
                for index in range(len(branch)-1, 0, -1):
                    if branch[index] == boundary: break
                    parent = branch[index-1]
                    siblings = children(parent)
                    if branch[index] in siblings:
                        expansion.extend(siblings[siblings.index(branch[index])+1:])
                    if parent == boundary: break
                for node in expansion:
                    if node in seen: continue
                    value = node_body(node)
                    if value: selection.append((*value, self.path(value[0]['node_id']))); break
                # Recall is not an access grant or another chapter. Re-resolve
                # the exact previously displayed focus under today's reader.
                # The immutable resolver, visible ancestors and normal budgets
                # still decide whether any body can be supplied.
                if not selection and recall_current and focus in seen:
                    value=node_body(focus)
                    if value:
                        row,body=value
                        if body['node_id']==focus:
                            row['_topic_root']=previous['root']
                            selection.append((row,body,self.path(focus)));mode='recall'
            if not selection and named and not terms.difference(words(' '.join(visible(root)['title'] for root in named if visible(root)))):
                mode = 'overview'
                for root in named:
                    value = node_body(root)
                    if value: selection.append((*value, self.path(value[0]['node_id']))); continue
                    for node in children(root):
                        value = node_body(node)
                        if value: selection.append((*value, self.path(value[0]['node_id']))); break
            if not selection and not (follow and more and generic):
                best=None;covered=set()
                for score, _, row, path in candidates:
                    if len(selection) >= 12: break
                    # A blocked high-ranking reference cannot suppress a lower
                    # ranked qualified account. Compare admitted bodies only.
                    novel=row['_query_hits']-covered
                    if multipart and selection and not novel:continue
                    if best is not None and score<best*0.75 and not(multipart and novel):break
                    if any(x[0]['node_id'] == row['node_id'] for x in selection): continue
                    body = admit(row['id'])
                    if body:
                        if best is None:best=score
                        covered.update(row['_query_hits'])
                        selection.append((row, body, path))
                # Similarity chooses only a missing relevant account, after
                # actor/source and visible-ancestor admission. It supplies no
                # knowledge grant and cannot replace an accepted literal body.
                if not selection and semantic_choice:
                    similarity,_,row,path,body=semantic_choice
                    selection.append((row,body,path))
                    semantic_context=automatic
                    trace.append(dict(candidate=row['id'],status='semantic_relevance',score=similarity))
            passages = []; used = 0; roots = set(prior_subjects); normalized_existing = normalize(existing)
            for row, body, path in selection:
                if len(passages)>=max_accounts:break
                root = row.get('_topic_root',row['entry_node_id'])
                if root not in roots and len(roots) >= 2:
                    trace.append(dict(candidate=row['id'],status='subject_budget_exceeded'));continue
                visible_path = [visible(node) for node in path]
                if not visible_path or any(x is None for x in visible_path):
                    trace.append(dict(candidate=row['id'], status='unavailable_ancestor')); continue
                labels = []
                if root!=row['entry_node_id']and visible(root):labels.append(visible(root)['title'])
                for value in visible_path:
                    if not labels or labels[-1] != value['title']: labels.append(value['title'])
                heading = ' — '.join(labels)
                count = len((heading+' '+body['text']).split())
                if normalize(body['text']) in normalized_existing:
                    trace.append(dict(candidate=row['id'], status='already_in_context')); continue
                if used + count > max_words:
                    trace.append(dict(candidate=row['id'], status='disclosure_budget_exceeded')); continue
                used += count; roots.add(root)
                passage=dict(**{k:body[k] for k in ['node_id','title','text']}, heading=heading, subject_id=root)
                resolution=reported_resolution(reader,body['node_id'],body['text'])
                if resolution:passage['reported_resolution']=resolution
                if hasattr(reader,'observed_turning'):
                    turning=reader.observed_turning(body['node_id'],body['text'])
                    if turning:passage['observed_turning']=turning
                passages.append(passage)
                trace.append(dict(candidate=row['id'], status='recalled'if mode=='recall'else'disclosed', depth=len(path)-1, path=path))
            state = {}
            if passages:
                selected = next(x for x in reversed(selection) if x[1]['node_id'] == passages[-1]['node_id'])
                root = selected[0].get('_topic_root',selected[0]['entry_node_id'])
                state = dict(previous)if mode=='recall'else dict(version=VERSION, context=reader.fingerprint, root=root, focus=selected[0]['node_id'],
                             focus_title=passages[-1]['heading'],
                             broad=mode=='overview' or (mode=='deepen' and previous.get('broad',False)),
                             boundary=(previous.get('boundary',previous.get('root') if previous.get('broad') else previous.get('focus')) if mode=='deepen'
                                       else root if mode=='overview' else selected[0]['node_id']),
                             shown=list(dict.fromkeys(previous.get('shown', []) + [p['node_id'] for p in passages]))[-32:])
                if scene or semantic_context:state['focus_origin']='scene'
            access='existing'if passages and mode=='recall'else'provided'if passages else 'existing'if any(t['status']=='already_in_context'for t in trace)else 'continuation'if follow and previous else 'not_established'if named or attempts or trace else'not_requested'
            return dict(text='\n\n'.join(p['heading']+'\n'+p['text'] for p in passages), passages=passages, trace=trace,
                        words=used, actor_id=reader.state['lore_knowledge']['actor_id'], context_fingerprint=reader.fingerprint,
                        disclosure=dict(version=VERSION, mode=mode if passages else 'empty', probes=attempts, access=access,
                                        intent='continue'if explicit_more and follow and generic else'query'if requested else'none'), state=state)
