import { app } from 'electron';
import fs from 'fs';
import { resolveUserDataRoot } from '../shared/runtimePaths';
import { APP_DISPLAY_NAME, LEGACY_USER_DATA_NAME } from '../shared/appIdentity';

// Run before modules that cache userData paths (diaries, memories and letter stores).
const dataRoot = resolveUserDataRoot(app.getPath('appData'), LEGACY_USER_DATA_NAME, process.env.VOTC_TITAN_USER_DATA_ROOT);
fs.mkdirSync(dataRoot, { recursive: true });
app.setPath('userData', dataRoot);
app.setPath('sessionData', dataRoot);
app.setName(APP_DISPLAY_NAME);
