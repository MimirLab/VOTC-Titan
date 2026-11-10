"""Current-culture familiarity without inventing a user-reported campaign history.

Experimental host adapter, not enabled in the production worker. It uses the
unchanged accepted resolver and CampaignReader navigation but withdraws ALL
base/history reads. Only already-qualified common customs can be admitted.
"""
import copy,hashlib,json,re
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
    if not isinstance(context,dict) or set(context)!=fields or context['origin']!='verified_current_culture':raise ValueError('Verified current culture context required')
    if any(not isinstance(context[k],str) or not context[k] or len(context[k])>256 for k in ['campaign_id','timeline_id','actor_id']):raise ValueError('Observed actor/campaign identity required')
    if not isinstance(context['as_of'],str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}',context['as_of']):raise ValueError('Observed clock required')
    try:date.fromisoformat(context['as_of'])
    except ValueError:raise ValueError('Invalid observed clock') from None
    if context['setting_sha256']!=pin(pack.reference.path)['sha256']:raise ValueError('Observed setting edition differs')
    matches=[r for r in policy['bindings'] if encoded(r['heritageFact'])==encoded(context['culture_heritage'])]
    if len(matches)!=1:raise ValueError('Unmapped or changed cultural heritage definition')
    selected=matches[0]
    if not selected['observedCultureDefinitions']:raise ValueError('No inspected culture membership for this heritage')

    class ObservedCommonReader(CampaignReader):
        def __init__(self):
            self.upstream=pack.reference.upstream;self.reference=pack.reference;self.mode='history'
            self.state={**copy.deepcopy(context),'lore_knowledge':{'actor_id':context['actor_id'],'as_of':context['as_of'],
                'setting_sha256':context['setting_sha256'],'known_subjects':[selected['subjectId']]}}
            self.known=frozenset([self.subject(selected['subjectId'])])
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
        def read(self,node_id,cursor=None):
            self._check_context()
            nid=self._expanded(node_id)
            if nid not in self.navigation:raise ValueError(UNAVAILABLE)
            return super().read(node_id,cursor)

    return ObservedCommonReader()
