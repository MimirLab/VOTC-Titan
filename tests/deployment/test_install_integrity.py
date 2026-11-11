import importlib.util,json,os,sys,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'tools'))
def module(name,file):
 spec=importlib.util.spec_from_file_location(name,ROOT/'tools'/file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
deploy=module('deploy_integrity','deploy-native.py');build=module('build_integrity','build-native.py')
class InstallIntegrity(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='titan-install-integrity-');self.addCleanup(self.tmp.cleanup);self.root=Path(self.tmp.name)
 def fixture(self):
  home=self.root/'home';state=home/'.local/share/votc-mimir';target=state/'native/app-2.2.0-beta2-titan';stage=self.root/'stage/application'
  for base,label in [(target,'old'),(stage,'new')]:
   (base/'resources/app/public/assets').mkdir(parents=True);(base/'resources/app/public/assets/titan-icon.png').write_bytes(b'icon');(base/'resources/app/package.json').write_text(json.dumps({'votcMimirDeployment':True,'votcTitanRuntime':'linux-x64'}));(base/'payload').write_text(label)
  (stage.parent/'votc-launch').write_text('fixture-launcher');(stage.parent/'manifest.json').write_text(json.dumps({'application_sha256':deploy.tree_hash(stage),'launcher_sha256':deploy.tree_hash(stage.parent/'votc-launch'),'engine_acceptance':'fixture'}))
  for key,value in dict(USER=home,STATE=state,TARGET=target,STAGE=stage).items():
   p=patch.object(deploy,key,value);p.start();self.addCleanup(p.stop)
  for key in ['ensure_closed','require_deployment_space','prune_backups']:
   p=patch.object(deploy,key);p.start();self.addCleanup(p.stop)
  p=patch.dict(os.environ,{'XDG_DATA_HOME':str(home/'custom-share')});p.start();self.addCleanup(p.stop)
  return target,stage
 def test_interrupt_during_copy_keeps_live_and_allows_retry(self):
  target,stage=self.fixture();before=deploy.tree_hash(target);real=deploy.copy_tree
  def interrupted(src,dst,**kw):
   if dst.name.endswith('.staging'):
    (dst/'partial').write_text('partial');raise KeyboardInterrupt()
   return real(src,dst,**kw)
  with patch.object(deploy,'copy_tree',side_effect=interrupted):
   with self.assertRaises(KeyboardInterrupt):deploy.install_locked()
  self.assertEqual(deploy.tree_hash(target),before);self.assertFalse(target.with_name(target.name+'.staging').exists())
  deploy.install_locked();self.assertEqual(deploy.tree_hash(target),deploy.tree_hash(stage))
 def test_interrupt_after_exchange_restores_old_native_and_integration(self):
  target,stage=self.fixture();before=deploy.tree_hash(target)
  def interrupted(*args):
   self.assertTrue((target/'resources/app/package.json').exists());self.assertEqual((target/'payload').read_text(),'new');raise KeyboardInterrupt()
  with patch.object(deploy,'apply_integration',side_effect=interrupted):
   with self.assertRaises(KeyboardInterrupt):deploy.install_locked()
  self.assertEqual(deploy.tree_hash(target),before);self.assertFalse((deploy.STATE/'native-install-pending.json').exists())
  deploy.install_locked();self.assertEqual((target/'payload').read_text(),'new')
 def test_next_run_recovers_uncaught_interruption_between_exchange_and_journal(self):
  target,stage=self.fixture();old=deploy.tree_hash(target)
  # Leave the journal behind as SIGKILL would, then run the real recovery path.
  def killed(*args):raise SystemExit(137)
  real=deploy.recover_pending_install
  with patch.object(deploy,'apply_integration',side_effect=killed),patch.object(deploy,'recover_pending_install',side_effect=[None,None]):
   with self.assertRaises(SystemExit):deploy.install_locked()
  real();self.assertEqual(deploy.tree_hash(target),old)
  deploy.install_locked();self.assertEqual((target/'payload').read_text(),'new')
 def test_custom_xdg_menu_icon_and_backup_targets_match(self):
  target,stage=self.fixture();deploy.install_locked();data=deploy.USER/'custom-share'
  menu=data/'applications/votc.desktop';icon=data/'icons/hicolor/256x256/apps/votc-titan-edition.png'
  self.assertTrue(menu.exists());self.assertIn(str(icon),menu.read_text());self.assertTrue(icon.exists())
  self.assertFalse((deploy.USER/'.local/share/applications/votc.desktop').exists())
  self.assertIn(menu,[p for p,_ in deploy.integration_targets()])
 def test_unowned_staging_is_preserved(self):
  target,stage=self.fixture();staging=target.with_name(target.name+'.staging');staging.mkdir();(staging/'keep').write_text('owned by someone else')
  with self.assertRaisesRegex(RuntimeError,'existing native staging'):deploy.install_locked()
  self.assertEqual((staging/'keep').read_text(),'owned by someone else')
 def test_atomic_exchange_failure_keeps_live(self):
  target,stage=self.fixture();before=deploy.tree_hash(target)
  with patch.object(deploy,'exchange_directories',side_effect=OSError('unsupported')):
   with self.assertRaises(OSError):deploy.install_locked()
  self.assertEqual(deploy.tree_hash(target),before)
 def test_missing_corrupt_and_wrong_dependency_receipts_rebuild_stale_modules(self):
  for receipt_value in [None,'{bad','[]',json.dumps({'fingerprint':'old'}),json.dumps({'fingerprint':'new','abi':1,'electron':build.VERSION})]:
   with self.subTest(receipt=receipt_value):
    directory=self.root/str(len(list(self.root.iterdir())));directory.mkdir();source=directory/'source';modules=directory/'modules';source.mkdir();modules.mkdir();(source/'new').write_text('current dependency');(modules/'stale').write_text('old dependency');receipt=directory/'receipt.json'
    if receipt_value is not None:receipt.write_text(receipt_value)
    build.prepare_dependencies(source,modules,receipt,'new')
    self.assertFalse((modules/'stale').exists());self.assertTrue((modules/'new').exists());self.assertFalse(receipt.exists())
if __name__=='__main__':unittest.main()
