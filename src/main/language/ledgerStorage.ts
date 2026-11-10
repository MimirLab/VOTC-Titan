import fs from 'fs';
import path from 'path';
import { createHash, randomUUID } from 'crypto';
import { LedgerSnapshot } from './conversationLedger';
import { readRecipientHistory, validateLedger } from './languageHistory';
import type { PerceptionPurpose } from './languageConversation';

function atomic(file: string, value: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${randomUUID()}.tmp`;
    const fd = fs.openSync(temp, 'wx', 0o600);
    try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    try { fs.renameSync(temp, file); } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
export function saveLedgerCheckpoint(historyDirectory: string, snapshot: LedgerSnapshot): void {
    validateLedger(snapshot);
    atomic(path.join(historyDirectory, '.language-ledgers', snapshot.id + '.json'), snapshot);
}
/** Campaign and compatibility indexes share one canonical file. Index has no listener transcript. */
export function saveLedgerHistory(historyDirectory: string, basename: string, snapshot: LedgerSnapshot,
    canonicalHistoryDirectory = historyDirectory): void {
    saveLedgerCheckpoint(canonicalHistoryDirectory, snapshot);
    const digest = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
    atomic(path.join(historyDirectory, '.recipient-views', basename + '.json'), {
        version: 2, ledgerId: snapshot.id, revision: snapshot.revision, sha256: digest
    });
}
export function loadLedgerHistory(historyDirectory: string, basename: string, characterId: number,
    canonicalHistoryDirectory = historyDirectory, purpose: PerceptionPurpose = 'knowledge'): { date: string; scene?: string; location?: string; messages: ReturnType<typeof readRecipientHistory> } | undefined {
    if (path.basename(basename) !== basename) throw new Error('Invalid history name');
    const indexPath = path.join(historyDirectory, '.recipient-views', basename + '.json');
    if (!fs.existsSync(indexPath)) return;
    const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    if (index.version === 1) return { date: index.date, messages: readRecipientHistory(index, characterId, purpose) };
    if (index.version !== 2 || typeof index.ledgerId !== 'string' || !/^[a-f0-9-]{36}$/.test(index.ledgerId))
        throw new Error('Invalid ledger history index');
    const ledger = validateLedger(JSON.parse(fs.readFileSync(path.join(canonicalHistoryDirectory, '.language-ledgers', index.ledgerId + '.json'), 'utf8')));
    if (ledger.id !== index.ledgerId || ledger.revision !== index.revision ||
        createHash('sha256').update(JSON.stringify(ledger)).digest('hex') !== index.sha256)
        throw new Error('History index does not match its canonical ledger');
    return { date: ledger.date, scene: ledger.scene, location: ledger.location, messages: readRecipientHistory(ledger, characterId, purpose) };
}
