from pathlib import Path
import importlib.util
import json
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
from deployment_common import tree_hash
import storage_policy

def tool(name):
    spec=importlib.util.spec_from_file_location(name,ROOT/'tools'/f'{name}.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

class SceneReenableTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(prefix='titan-scene-reenable-');self.root=Path(self.temp.name)
        self.ck3=self.root/'ck3';self.ck3.mkdir();(self.ck3/'mod').mkdir()
        self.stage=self.root/'stage';self.stage.mkdir();self.state=self.root/'state'
        self.installer=tool('install-titan-scene-addon');self.enabler=tool('enable-titan-scenes')
        for key in ['ugc_3654567139','ugc_2949767945']:
            folder=self.root/key;folder.mkdir();(self.ck3/'mod'/f'{key}.mod').write_text('path='+json.dumps(str(folder)))
        (self.stage/'descriptor.mod').write_text('name="Titan Scenes"\n')
        (self.stage/'titan-scene-addon.json').write_text(json.dumps({'name':'Titan Scenes','version':'fixture','cePins':{}}))
        self.digest=tree_hash(self.stage);self.stage.with_suffix('.sha256').write_text(self.digest)
        self.receipt=self.root/'qualification.json';self.receipt.write_text(json.dumps({'passed':True,'addonSha256':self.digest}))
        self.enabled=[self.installer.GOA,self.installer.CE];self.load(self.enabled)
        with sqlite3.connect(self.ck3/'launcher-v2.sqlite') as db:
            db.executescript('CREATE TABLE playsets(id TEXT PRIMARY KEY,isActive INT,isRemoved INT);'
                'CREATE TABLE mods(id TEXT PRIMARY KEY,gameRegistryId TEXT,name TEXT,displayName TEXT,version TEXT,tags TEXT,dirPath TEXT,status TEXT,source TEXT,isNew INT,createdDate TEXT,timeUpdated INT,isMetadataApplied INT,metadataStatus TEXT,keepLatest INT,userVersion INT);'
                'CREATE TABLE playsets_mods(playsetId TEXT,modId TEXT,enabled INT,position INT);'
                'CREATE TABLE private_sentinel(value TEXT); INSERT INTO private_sentinel VALUES("preserve");'
                'INSERT INTO playsets VALUES("A",1,0),("B",0,0);')
            for index,registry in enumerate(self.enabled):
                db.execute('INSERT INTO mods(id,gameRegistryId) VALUES(?,?)',(str(index),registry))
                for playset in ['A','B']: db.execute('INSERT INTO playsets_mods VALUES(?,?,1,?)',(playset,str(index),index))
        self.guard=patch.object(self.installer,'ensure_closed');self.guard.start()
    def tearDown(self):self.guard.stop();self.temp.cleanup()
    def load(self,enabled):(self.ck3/'dlc_load.json').write_text(json.dumps({'enabled_mods':enabled,'disabled_dlcs':[]}))
    def install(self):self.installer.install(self.stage,self.ck3,self.receipt,self.state)
    def test_clean_repeat_disabled_and_second_playset_reuse_one_mod(self):
        self.install();target=(self.ck3/self.installer.REGISTRY).with_suffix('');self.assertEqual(tree_hash(target),self.digest)
        with patch.object(self.enabler,'ensure_closed'),patch.object(self.enabler,'QUALIFICATION',self.receipt),patch.object(self.enabler,'scene_tool',side_effect=lambda name:self.installer if name=='install-titan-scene-addon' else None):
            self.enabler.enable(self.ck3,self.root/'unused-art',self.state) # repeat succeeds without writes
            for playset in ['B','A']:
                with sqlite3.connect(self.ck3/'launcher-v2.sqlite') as db:
                    db.execute('UPDATE playsets SET isActive=(id=?)',(playset,))
                    db.execute('UPDATE playsets_mods SET enabled=0 WHERE playsetId=? AND modId IN (SELECT id FROM mods WHERE gameRegistryId=?)',(playset,self.installer.REGISTRY))
                self.load(self.enabled)
                self.enabler.enable(self.ck3,self.root/'unused-art',self.state)
                self.assertEqual(json.loads((self.ck3/'dlc_load.json').read_text())['enabled_mods'],self.enabled+[self.installer.REGISTRY])
        with sqlite3.connect(self.ck3/'launcher-v2.sqlite') as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM mods WHERE gameRegistryId=?',(self.installer.REGISTRY,)).fetchone()[0],1)
            self.assertEqual(db.execute('SELECT value FROM private_sentinel').fetchone()[0],'preserve')
        self.assertEqual(tree_hash(target),self.digest)
    def test_corrupt_existing_addon_cannot_be_reenabled(self):
        self.install();target=(self.ck3/self.installer.REGISTRY).with_suffix('');(target/'descriptor.mod').write_text('tampered')
        self.load(self.enabled);before=(self.ck3/'launcher-v2.sqlite').read_bytes()
        with self.assertRaisesRegex(ValueError,'differs'):self.installer.reenable(self.ck3,self.state,self.digest)
        self.assertEqual((self.ck3/'launcher-v2.sqlite').read_bytes(),before)
    def test_public_installation_does_not_apply_the_development_reserve(self):
        with patch.object(storage_policy.shutil,'disk_usage',return_value=type('Usage',(),{'free':20*1024**3})()):
            storage_policy.require_deployment_space(self.root,2*1024**3)
            with self.assertRaisesRegex(RuntimeError,'reserve'):storage_policy.require_space(self.root)
        with patch.object(storage_policy.shutil,'disk_usage',return_value=type('Usage',(),{'free':500})()):
            with self.assertRaisesRegex(RuntimeError,'Free space on this drive') as error:storage_policy.require_deployment_space(self.root)
            self.assertNotIn('maintain-storage.py',str(error.exception))

if __name__=='__main__':unittest.main()
