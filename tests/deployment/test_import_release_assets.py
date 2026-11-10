from pathlib import Path
import hashlib
import importlib.util
import json
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
spec=importlib.util.spec_from_file_location('import_release_assets',ROOT/'tools/import-release-assets.py')
assets=importlib.util.module_from_spec(spec);spec.loader.exec_module(assets)

class ReleaseAssetsTests(unittest.TestCase):
 def setUp(self):
  self.space=patch.object(assets,'require_space');self.space.start();self.addCleanup(self.space.stop)
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name)
  self.source=self.root/'fixture';self.target=self.root/'checkout';self.target.mkdir()
  for name in assets.ASSETS:
   file=self.source/'public'/name/'fixture.txt';file.parent.mkdir(parents=True);file.write_text('exact asset '+name)
  self.archive=self.root/'download.tar.gz'
  with tarfile.open(self.archive,'w:gz') as tar:
   for name in assets.ASSETS:tar.add(self.source/'public'/name,arcname='Titan/application/resources/app/public/'+name)
   private=self.root/'private.txt';private.write_text('do not extract')
   tar.add(private,arcname='Titan/application/resources/app/default_userdata/private.txt')
  self.policy=self.root/'release-assets.json'
  self.policy.write_text(json.dumps({'archive_sha256':assets.digest(self.archive),'archive_public_prefix':'Titan/application/resources/app/public/',
    'asset_tree_sha256':{name:assets.tree_hash(self.source/'public'/name) for name in assets.ASSETS}}))
 def tearDown(self):self.temp.cleanup()
 def test_imports_only_verified_assets_and_is_idempotent(self):
  report=assets.import_assets(self.archive,self.target,self.policy);self.assertEqual(report['importedFiles'],3)
  self.assertFalse((self.target/'default_userdata').exists());self.assertFalse((self.target/'application').exists())
  self.assertEqual(assets.import_assets(self.archive,self.target,self.policy)['importedFiles'],0)
  for name in assets.ASSETS:self.assertEqual(assets.tree_hash(self.target/'public'/name),assets.tree_hash(self.source/'public'/name))
 def test_wrong_download_checksum_fails_before_writes(self):
  self.archive.write_bytes(self.archive.read_bytes()+b'changed')
  with self.assertRaisesRegex(RuntimeError,'checksum'):assets.import_assets(self.archive,self.target,self.policy)
  self.assertEqual(list(self.target.iterdir()),[])
 def test_changed_existing_asset_is_retained_and_no_other_assets_are_written(self):
  file=self.target/'public/audio/fixture.txt';file.parent.mkdir(parents=True);file.write_text('keep local')
  with self.assertRaisesRegex(RuntimeError,'existing asset differs'):assets.import_assets(self.archive,self.target,self.policy)
  self.assertEqual(file.read_text(),'keep local');self.assertFalse((self.target/'public/scene-art').exists())
 def test_existing_destination_link_cannot_write_outside_checkout(self):
  outside=self.root/'outside';outside.mkdir();(self.target/'public').mkdir();(self.target/'public/audio').symlink_to(outside,target_is_directory=True)
  with self.assertRaisesRegex(RuntimeError,'destination escapes'):assets.import_assets(self.archive,self.target,self.policy)
  self.assertEqual(list(outside.iterdir()),[])
 def test_space_guard_stops_before_extraction_or_source_writes(self):
  with patch.object(assets,'require_space',side_effect=RuntimeError('Insufficient build space')):
   with self.assertRaisesRegex(RuntimeError,'Insufficient build space'):assets.import_assets(self.archive,self.target,self.policy)
  self.assertEqual(list(self.target.iterdir()),[])
if __name__=='__main__':unittest.main()
