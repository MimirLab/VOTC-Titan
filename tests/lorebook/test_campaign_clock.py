"""Real SQLite/upstream reader checks: sample dates cannot become RP history."""
from pathlib import Path
import json
import sqlite3
import sys
import tempfile
import unittest

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
BUNDLE = ROOT / 'public/lorebook/bundle'
sys.path[:0] = [str(BUNDLE/'vendor'), str(BUNDLE), str(ROOT/'tools')]
from lorebank.db import Database
from lorebank.goa_reader import GoAReader
from lorebook_campaign_clock import bind_campaign_clock


class CampaignClockTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='titan-campaign-clock-')
        self.root = Path(self.temp.name)
        self.base = self.root/'base.sqlite3'
        self.supplement = self.root/'goa.sqlite3'
        tables = ['pages','entries','nodes','passages','events','campaigns','outcomes','scoped_outcome_proofs','settings','links']
        with sqlite3.connect(BUNDLE.joinpath('base.sqlite3').resolve().as_uri()+'?mode=ro',uri=True) as source, sqlite3.connect(self.base) as c:
            for table in tables:
                c.execute(source.execute("SELECT sql FROM sqlite_master WHERE name=?",(table,)).fetchone()[0])
            c.executemany('INSERT INTO settings VALUES(?,?)',[('active_campaign','sample'),('active_timeline','initial'),('corpus_revision','1')])
            c.execute("INSERT INTO campaigns VALUES('sample','initial','0582-12-31','0582-12-31',NULL,0)")
            c.execute("INSERT INTO pages VALUES('p','Fixture history')")
            c.execute("INSERT INTO entries VALUES('e','p','Fixture history','test')")
            c.execute("INSERT INTO nodes VALUES('n','e',NULL,'Fixture history',0)")
            c.execute("INSERT INTO events VALUES('world-turning','A turning','0353-01-01','direct_source_editorial','{}')")
            requirements=json.dumps([{'event_id':'world-turning','outcome':'occurred'}])
            c.execute('INSERT INTO passages VALUES(?,?,?,?,?,?,?,?)',('passage','n','Fixture history','A later turning took place.','', '0353-01-01',requirements,'ready'))
        source.close(); c.close()
        with sqlite3.connect(BUNDLE.joinpath('goa.sqlite3').resolve().as_uri()+'?mode=ro',uri=True) as source, sqlite3.connect(self.supplement) as c:
            for table in ['branches','nodes','metadata']:
                c.execute(source.execute("SELECT sql FROM sqlite_master WHERE name=?",(table,)).fetchone()[0])
            c.executemany('INSERT INTO metadata VALUES(?,?)',[('mod_version',json.dumps('0.6.5')),
                ('base_entry_roots',json.dumps({'e':{'root_id':'n','title':'Fixture history'}}))])
            evidence={'source':{'block_sha256':'a'*64},'conditional_marker_scopes':[]}
            c.execute('INSERT INTO branches VALUES(?,?,?,?,?,?,?,?,?)',('goa:branch:test','fixture.1','An alternate choice','test','[]','["e"]','[{"option_index":0}]','coded_choice',json.dumps(evidence)))
            c.execute('INSERT INTO nodes VALUES(?,?,?,?,?,?)',('goa:branch:test',None,'goa:branch:test','An alternate choice','A present choice, not a future historical claim.',0))
        source.close(); c.close()

    def tearDown(self): self.temp.cleanup()

    def reader(self,start='0300-01-01',now='0301-01-01',bind=True):
        state={'origin':'synthetic_test','campaign_id':'c','timeline_id':'fork','start_date':start,'as_of':now,
            'mod_version':'0.6.5','choices':[{'branch_id':'goa:branch:test','definition_sha256':'a'*64,
            'occurred_at':now,'actor_context':{'actor_id':'2'},'guard_evidence':{'choice_reported':True},'option_index':0}]}
        reader=GoAReader(Database(self.base),self.supplement,mode='history',state=state,allow_synthetic=True)
        return bind_campaign_clock(reader) if bind else reader

    def test_earlier_annals_do_not_expose_history_after_the_actual_clock(self):
        reader=self.reader()
        with self.assertRaises(ValueError): reader.read('goa:earlier:n')
        self.assertFalse(any(x['node_id']=='goa:earlier:n' for x in reader.read('n')['children']))

    def test_calendar_advance_does_not_confirm_an_unreported_post_start_turning(self):
        with self.assertRaises(ValueError): self.reader(now='0600-01-01').read('goa:earlier:n')

    def test_legitimate_pre_start_annals_remain_available(self):
        reader=self.reader(start='0580-01-01',now='0581-01-01')
        self.assertIn('A later turning took place.',reader.read('goa:earlier:n')['text'])
        self.assertTrue(any(x['node_id']=='goa:earlier:n' for x in reader.read('n')['children']))

    def test_an_older_canonical_turning_averted_on_this_fork_stays_unavailable(self):
        with sqlite3.connect(self.base) as c:
            c.execute("INSERT INTO campaigns VALUES('c','fork','0580-01-01','0581-01-01',NULL,0)")
            c.execute("INSERT INTO outcomes VALUES('c','fork','world-turning','averted','0580-01-01','synthetic_test')")
        c.close()
        with self.assertRaises(ValueError):self.reader(start='0580-01-01',now='0581-01-01').read('goa:earlier:n')

    def test_reference_reader_cannot_be_mislabelled_as_campaign_history(self):
        reference=GoAReader(Database(self.base),self.supplement)
        with self.assertRaisesRegex(ValueError,'campaign history'):bind_campaign_clock(reference)


if __name__=='__main__':unittest.main()
