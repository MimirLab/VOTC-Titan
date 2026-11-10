import fs from 'fs';

const CLOSE_RECEIPT = 'VOTC:TITAN_CLOSE/;/applied/;/';
export interface CloseCheckpoint {
    nonce: string;
    playerId: number;
    epoch: number;
    nodeId: string;
}
export type CloseReceiptResult = 'confirmed' | 'timeout' | 'superseded' | 'unavailable';

/** Read the player's actual values after applying the close, rather than echoing intended literals. */
export function closeCheckpointReceiptEffect(nonce: string): string {
    if (!/^[a-f0-9-]{36}$/.test(nonce)) throw new Error('Invalid close receipt nonce');
    return `debug_log = "${CLOSE_RECEIPT}${nonce}/;/[GetPlayer.GetID]/;/[GetPlayer.MakeScope.Var('votc_checkpoint_epoch').GetValue|0]/;/[GetPlayer.MakeScope.Var('votc_timeline_node_a').GetValue|0]/;/[GetPlayer.MakeScope.Var('votc_timeline_node_b').GetValue|0]"`;
}

export function matchesCloseCheckpointReceipt(text: string, expected: CloseCheckpoint): boolean {
    const marker = CLOSE_RECEIPT + expected.nonce + '/;/';
    return text.split(/\r?\n/).some(line => {
        const start = line.indexOf(marker);
        if (start < 0) return false;
        const fields = line.slice(start + marker.length).trim().split('/;/');
        if (fields.length !== 4 || fields.some(field => !/^\d+$/.test(field))) return false;
        const [player, epoch, nodeA, nodeB] = fields.map(Number);
        return [player, epoch, nodeA, nodeB].every(Number.isSafeInteger) && player === expected.playerId &&
            epoch === expected.epoch && `${nodeA}-${nodeB}` === expected.nodeId;
    });
}

export function ownsCloseCommand(runFilePath: string, command: string, allowed: () => boolean): boolean {
    if (!allowed()) return false;
    try { return fs.readFileSync(runFilePath, 'utf8').replace(/^\uFEFF/, '') === command; }
    catch { return false; }
}

/** The game polls its run file. Keep the command available until a matching receipt or a bounded timeout. */
export async function waitForCloseCheckpoint(options: {
    gameLogPath: string;
    runFilePath: string;
    command: string;
    expected: CloseCheckpoint;
    offset: number;
    allowed: () => boolean;
    timeoutMs?: number;
    pollMs?: number;
}): Promise<CloseReceiptResult> {
    const deadline = Date.now() + (options.timeoutMs ?? 4000);
    let offset = options.offset, trailing = '';
    if (!fs.existsSync(options.gameLogPath)) return 'unavailable';
    while (true) {
        if (!ownsCloseCommand(options.runFilePath, options.command, options.allowed)) return 'superseded';
        try {
            const size = fs.statSync(options.gameLogPath).size;
            if (size < offset) { offset = 0; trailing = ''; }
            if (size > offset) {
                const fd = fs.openSync(options.gameLogPath, 'r');
                const bytes = Buffer.alloc(Math.min(size - offset, 1024 * 1024));
                let read = 0;
                try { read = fs.readSync(fd, bytes, 0, bytes.length, offset); offset += read; } finally { fs.closeSync(fd); }
                const text = trailing + bytes.subarray(0, read).toString('utf8');
                const lastLine = text.lastIndexOf('\n');
                if (lastLine >= 0) {
                    if (matchesCloseCheckpointReceipt(text.slice(0, lastLine), options.expected)) return 'confirmed';
                    trailing = text.slice(lastLine + 1);
                } else trailing = text;
                // A valid receipt is small; never accumulate an arbitrary unterminated log line.
                if (trailing.length > 4096) trailing = trailing.slice(-4096);
            }
        } catch { return 'unavailable'; }
        if (Date.now() >= deadline) return 'timeout';
        await new Promise<void>(resolve => setTimeout(resolve, options.pollMs ?? 100));
    }
}
