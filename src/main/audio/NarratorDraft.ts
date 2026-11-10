import fs from 'fs';
import os from 'os';
import path from 'path';
import { VoiceProfile } from '../../shared/audio';
import { AudioLibrary } from './AudioLibrary';

/** One disposable audition. It never creates a row in the player's voice library. */
export class NarratorDraft {
    readonly root = fs.mkdtempSync(path.join(os.tmpdir(), 'votc-narrator-draft-'));
    readonly library = new AudioLibrary(this.root);
    profile: VoiceProfile;
    savedId?: string;
    constructor(readonly key: string, instruction: string) {
        this.profile = this.library.save('__draft__', '__narrator__', 'Unsaved narrator', instruction, 'Temporary narrator audition', true);
    }
    close(): void { this.library.close(); fs.rmSync(this.root, { recursive: true, force: true }); }
}
