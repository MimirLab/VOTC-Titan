#!/usr/bin/env python3
"""Private JSON-lines offline bridge to the exact accepted lore reader.

No socket, account, game writes or working lore workspace. Only resolver.text
is narrative context. Candidate bodies and reference research are never grants.
"""
import hashlib
import json
from pathlib import Path
import re
import sqlite3
import sys
from contextlib import closing

BUNDLE = Path(sys.argv[1]).resolve()
TEST_MODE = sys.argv[2:] == ['--test-contexts']
disclosure = None
sys.path[:0] = [str(BUNDLE / 'vendor'), str(BUNDLE), str(Path(__file__).resolve().parent)]


def verify_vendor():
    receipt = json.loads((BUNDLE / 'titan-vendor.json').read_text())
    for name, ref in receipt['members'].items():
        file = (BUNDLE / name).resolve()
        if not file.is_relative_to(BUNDLE):
            raise ValueError('Invalid bundled runtime path')
        with file.open('rb') as stream:
            actual = hashlib.file_digest(stream, 'sha256').hexdigest()
        if file.stat().st_size != ref['bytes'] or actual != ref['sha256']:
            raise ValueError('Bundled Chronicle changed: ' + name)


def candidate_search(pack, query, limit=40):
    """Exact aliases first, then word-prefix FTS, then bounded chapter links."""
    tokens = re.findall(r'\w+', query, re.UNICODE)[:40]
    if not tokens:
        return []
    normalized = ' '.join(tokens).casefold()
    phrases = set()
    for width in range(1, min(8, len(tokens)) + 1):
        for i in range(len(tokens) - width + 1):
            phrases.add(' '.join(tokens[i:i+width]).casefold())
    ids = []
    with closing(pack.bundle.connect()) as c:
        # Recall the composed subject's authored chapters before archived base
        # variants consume the finite alias slots (e.g. humans + Holy Light).
        from lorebook_disclosure import anchors
        for root in anchors(pack,query):
            equivalents=[root]+[r[0]for r in c.execute('SELECT id FROM nodes WHERE canonical_id=?',(root,))]
            slots=','.join('?'for _ in equivalents)
            ids.extend(r[0]for r in c.execute('SELECT p.id FROM passages p JOIN nodes n ON n.id=p.node_id WHERE p.family=? AND (n.id IN ('+slots+') OR n.parent_id IN ('+slots+')) ORDER BY p.id LIMIT 10',('expanded',*equivalents,*equivalents)))
        slots = ','.join('?' for _ in phrases)
        aliases = c.execute('SELECT target_id,max(length(name)) n,min(CASE WHEN kind=\'context_route\' THEN 1 ELSE 0 END) route FROM aliases WHERE lower(name) IN ('+slots+') GROUP BY target_id ORDER BY route,n DESC,target_id LIMIT 12', tuple(sorted(phrases))).fetchall()
        aliases = [a for a in aliases if not a['route']][:4] + [a for a in aliases if a['route']][:2]
        for alias in aliases:
            ids.extend(r[0] for r in c.execute('SELECT id FROM passages WHERE node_id=? OR entry_node_id=? ORDER BY CASE WHEN node_id=? THEN 0 ELSE 1 END,id LIMIT 2',
                                             (alias[0], alias[0], alias[0])))
            # Identity aliases get their bounded chapter expansion before global
            # FTS, so thousands of co-mention routes cannot crowd out a custom.
            if not alias['route']:
                ids.extend(r[0] for r in c.execute('SELECT p.id FROM edges e JOIN passages p ON p.node_id=e.target_id WHERE e.source_id=? AND e.relation IN (?,?,?) ORDER BY e.relation,p.id LIMIT 8',
                                                 (alias[0], 'has_chapter', 'custom_practised_in', 'homeland_account')))
        # OR recalls indirect questions; bm25 ranks distinctive topic words.
        stop = {'a','an','the','i','you','we','they','he','she','it','my','your','our','his','her','their','and','or','of','to','in','is','are','was','were','be','do','does','did','can','could','would','should','will','have','has','had','for','with','that','this','what','when','where','how','why','tell','about','me','please'}
        terms = [t for t in tokens if len(t) > 2 and t.casefold() not in stop][:20]
        # Reserve half of the bounded union for global lexical matches. Several
        # exact subject aliases must not exhaust it before a local custom ranks.
        ids = list(dict.fromkeys(ids))[:limit // 2]
        if terms:
            def word_query(term):
                variants = [term]
                if len(term) > 4 and term.casefold().endswith('s') and not term.casefold().endswith('ss'):
                    variants.append(term[:-1])
                if len(term) > 4 and term.casefold().endswith('ies'):
                    variants.append(term[:-3] + 'y')
                return '(' + ' OR '.join(search_expression([v]) for v in variants) + ')'
            expression = ' OR '.join(word_query(t) for t in terms)
            ids.extend(r[0] for r in c.execute('SELECT passage_id FROM lexical WHERE lexical MATCH ? ORDER BY bm25(lexical,0,8,1),passage_id LIMIT ?', (expression, limit)))
    return list(dict.fromkeys(ids))[:limit]


def qualified_documents(pack):
    cached=getattr(pack,'_qualified_embedding_documents',None)
    if cached is not None:return cached
    result=[]
    with pack.reference.connect() as source,closing(pack.bundle.connect()) as catalog:
        nodes={r['id']:dict(r) for r in source.execute('SELECT * FROM nodes')}
        for policy in source.execute("SELECT * FROM knowledge_policies WHERE eligibility='reported_subject_knowledge' ORDER BY node_id"):
            node=nodes[policy['node_id']]
            if hashlib.sha256(node['text'].encode()).hexdigest()!=policy['text_sha256']:raise ValueError('Qualified embedding source changed')
            rows=catalog.execute("SELECT id,node_id,title,text,body_sha256 FROM passages WHERE family='expanded' AND node_id=?",(node['id'],)).fetchall()
            if len(rows)!=1 or rows[0]['text']!=node['text']:raise ValueError('Qualified embedding catalogue differs')
            row=dict(rows[0]);labels=[];at=node
            while at:labels.append(at['title']);at=nodes.get(at['parent_id'])
            row['embedding_text']=' — '.join(reversed(labels))+'\n'+node['text'];result.append(row)
    if len(result)!=pack.manifest['campaign_qualified_authored_passages']:raise ValueError('Qualified embedding edition count changed')
    pack._qualified_embedding_documents=sorted(result,key=lambda r:r['id'])
    return pack._qualified_embedding_documents

def semantic_coverage(pack,body):
    complete=body.get('semantic_complete',False)
    if type(complete)is not bool:raise ValueError('Invalid semantic score coverage')
    if complete:
        matches=body.get('semantic_matches',[])
        if not isinstance(matches,list)or len(matches)>64 or any(not isinstance(r,dict)or not isinstance(r.get('id'),str)for r in matches):raise ValueError('Invalid complete semantic scores')
        expected={r['id']for r in qualified_documents(pack)}
        if len(matches)!=len(expected)or{r['id']for r in matches}!=expected:raise ValueError('Incomplete qualified semantic score coverage')
    return complete

def run(pack, body):
    op = body.get('op')
    if op == 'status':
        return dict(ready=True, manifest_sha256=hashlib.sha256((BUNDLE/'manifest.json').read_bytes()).hexdigest(),
                    setting_sha256=pack.manifest['files']['expanded']['sha256'], counts=pack.manifest['counts'],
                    authored_qualified=pack.manifest['campaign_qualified_authored_passages'])
    if op == 'search':
        return pack.reference.search(str(body['query'])[:500], min(10, max(1, int(body.get('limit', 5)))), body.get('cursor'))
    if op == 'read':
        return pack.reference.read(str(body['node_id'])[:250], body.get('cursor'))
    if op == 'candidates':
        from lorebook_disclosure import anchors, focus_query, active_query, context_only_advance,quiet_company_request
        automatic=body.get('automatic',True)
        if type(automatic)is not bool:raise ValueError('Invalid retrieval origin')
        query = str(body['query'])[:1000]
        quiet=body.get('semantic_relevance')is True and automatic and quiet_company_request(query)
        if automatic:query=active_query(query)
        named = anchors(pack, query,contextual_topics=body.get('semantic_relevance')is True)
        previous = body.get('previous') if isinstance(body.get('previous'), dict) else None
        ranked=focus_query(query, previous, named) if query.strip() and not(automatic and context_only_advance(query,previous)) else ''
        if quiet:ranked=''
        return dict(ids=candidate_search(pack,ranked)if ranked else[],anchors=named,query=ranked)
    if op == 'documents':
        after = str(body.get('after', ''))
        with closing(pack.bundle.connect()) as c:
            result=[]
            for row in c.execute('SELECT id,node_id,title,text,body_sha256 FROM passages WHERE embed=1 AND id>? ORDER BY id LIMIT 64', (after,)):
                value=dict(row);ancestors=disclosure.path(row['node_id'])
                labels=[disclosure.nodes[node]['title']for node in ancestors[:-1]]+[row['title']]
                value['embedding_text']=' — '.join(labels)+'\n'+row['text'];result.append(value)
            return result
    if op == 'qualified-documents':
        after=str(body.get('after',''))
        return[r for r in qualified_documents(pack)if r['id']>after][:64]
    if op in {'observed-disclose', 'combined-disclose', 'mutation-disclose', 'game-state-disclose'}:
        # Separate host-observed provenance. Never relabel an observation as a
        # user report or enable the all-possibilities reference reader.
        if op in {'mutation-disclose', 'game-state-disclose'}:
            if op == 'game-state-disclose':
                from lorebook_game_state import game_state_reader
                reader = game_state_reader(pack, body['context'])
            else:
                from lorebook_mutations import mutation_reader
                reader = mutation_reader(pack, body['context'])
            candidates=body.get('candidate_ids',[])
            if not isinstance(candidates,list)or len(candidates)>100 or any(not isinstance(x,str)for x in candidates):
                raise ValueError('Invalid mutation disclosure candidates')
            candidates=list(dict.fromkeys(reader.candidate_ids(str(body['query'])[:1000])+candidates))[:100]
        else:
            from lorebook_observed import observed_reader, combined_reader
            if op == 'combined-disclose':
                context=body['context']
                if not isinstance(context,dict) or set(context)!={'origin','reported_context','common_context'} or context['origin']!='verified_report_and_culture':
                    raise ValueError('Verified combined context required')
                reader=combined_reader(pack,context['reported_context'],context['common_context'])
            else:
                reader = observed_reader(pack, body['context'])
            candidates=body.get('candidate_ids',[])
            if not isinstance(candidates,list) or len(candidates)>100 or any(not isinstance(x,str) for x in candidates):
                raise ValueError('Invalid observed disclosure candidates')
            candidates=list(dict.fromkeys(reader.candidate_ids(str(body['query'])[:1000])+candidates))[:100]
        return disclosure.deliver(reader, str(body['query'])[:1000], candidates,
            previous=body.get('previous'), max_words=body.get('max_words',350), existing=str(body.get('existing',''))[:100000],
            semantic_ids=body.get('semantic_ids',[])[:40], max_accounts=body.get('max_accounts',3), prior_subjects=body.get('prior_subjects',[]),automatic=body.get('automatic',True),recall_current=body.get('recall_current',False),scene_relevance=body.get('scene_relevance',False),semantic_relevance=body.get('semantic_relevance',False),semantic_matches=body.get('semantic_matches',[]),semantic_complete=semantic_coverage(pack,body))
    if op in {'resolve', 'validate-context', 'disclose'}:
        context = body['context']
        # The regular application cannot switch this private bridge into a
        # synthetic/reference selector for automatic NPC injection.
        if context.get('origin') not in ({'user_reported', 'synthetic_test'} if TEST_MODE else {'user_reported'}):
            raise ValueError('An explicit reported campaign context is required')
        from lorebook_campaign_clock import bind_campaign_clock
        reader = bind_campaign_clock(pack.reader(state=context))
        if op == 'validate-context':
            return dict(valid=True, actor_id=context['lore_knowledge']['actor_id'], context_fingerprint=reader.fingerprint)
        if op == 'disclose':
            return disclosure.deliver(reader, str(body['query'])[:1000], body.get('candidate_ids', []),
                previous=body.get('previous'), max_words=body.get('max_words',350), existing=str(body.get('existing',''))[:100000],
                semantic_ids=body.get('semantic_ids',[])[:40], max_accounts=body.get('max_accounts',3), prior_subjects=body.get('prior_subjects',[]),automatic=body.get('automatic',True),recall_current=body.get('recall_current',False),scene_relevance=body.get('scene_relevance',False),semantic_relevance=body.get('semantic_relevance',False),semantic_matches=body.get('semantic_matches',[]),semantic_complete=semantic_coverage(pack,body))
        ids = body.get('candidate_ids')
        if ids is None:
            ids = candidate_search(pack, str(body['query'])[:1000])
        if not isinstance(ids, list) or len(ids) > 100 or any(not isinstance(x, str) for x in ids):
            raise ValueError('Invalid candidate IDs')
        from lorebook_disclosure import ResolverPhase
        return ResolverPhase(pack.bundle).resolve(ids, reader, max_words=min(2000, max(1, int(body.get('max_words', 350)))))
    raise ValueError('Unknown Chronicle operation')


def main():
    verify_vendor()
    global search_expression, disclosure
    from lorebank.runtime_reader import RuntimePack
    from lorebank.reader import search_expression
    pack = RuntimePack(BUNDLE, candidate=TEST_MODE, allow_synthetic=TEST_MODE)
    from lorebook_disclosure import Disclosure
    disclosure = Disclosure(pack)
    print(json.dumps(dict(event='ready')), flush=True)
    for line in sys.stdin:
        request = None
        try:
            if len(line) > 1024 * 1024:
                raise ValueError('Request is too large')
            request = json.loads(line)
            result = run(pack, request['body'])
            print(json.dumps(dict(id=request['id'], result=result), ensure_ascii=False), flush=True)
        except Exception as error:
            print(json.dumps(dict(id=request.get('id') if isinstance(request, dict) else None,
                                  error=str(error))), flush=True)


if __name__ == '__main__':
    main()
