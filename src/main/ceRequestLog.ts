import fs from 'node:fs/promises';
import path from 'node:path';
import { parseGameDate } from '../shared/dateUtils';
import { removeTooltip } from '../shared/gameData/gameText';

const logLimit = 4 * 1024 * 1024;
const id = /^[1-9]\d{0,9}$/;
const counter = /^(?:0|[1-9]\d{0,9})$/;
const flag = /^[a-z][a-z_]{0,63}$/;

export function ceLogRecord(line: string): string[] {
    const start = line.indexOf('VOTC:');
    if (start < 0 || (start > 0 && !line.slice(0, start).endsWith(': '))) return [];
    return line.slice(start).split('/;/').map(value => value.trim());
}

export async function readCeLog(gameFolder: string): Promise<string> {
    const file = await fs.open(path.join(gameFolder, 'logs', 'debug.log'), 'r');
    try {
        const {size} = await file.stat();
        const length = Math.min(size, logLimit);
        const buffer = Buffer.alloc(length);
        const {bytesRead} = await file.read(buffer, 0, length, size - length);
        const text = buffer.subarray(0, bytesRead).toString('utf8');
        const start = size > length ? text.indexOf('\n') + 1 : 0;
        return text.slice(start, text.lastIndexOf('\n') + 1);
    } finally {
        await file.close();
    }
}

export function ceScriptDay(display: string): number | undefined {
    const date = parseGameDate(display);
    if (date && date.getFullYear() > 0) {
        // CE stores current_date as a zero-based day in a 365-day
        // calendar, unlike GetDateAsTotalDays in the log.
        const monthStarts = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
        return 365 * date.getFullYear() + monthStarts[date.getMonth()] + date.getDate() - 1;
    }
}

function clean(text: string | undefined, max = 300): string {
    return removeTooltip(text ?? '').replace(/[\x00-\x1f]/g, ' ').trim().slice(0, max);
}

export type CeIdentity = { player: string; campaign: string[] };
type LetterFacts = {
    sender: string;
    senderName: string;
    playerName: string;
    date: string;
    facts: string[];
};

export type CeRequest =
    | (CeIdentity & LetterFacts & { kind: 'incoming'; file: string; slot: string; type: string; delivery: string; sentDay: number })
    | (CeIdentity & LetterFacts & { kind: 'npc'; file: 'votc_ce_npcltr.txt'; type: string })
    | (CeIdentity & { kind: 'whisper'; file: 'votc_ce_whisper.txt'; section: string; step: number; nonce: string; day: string; facts: string[] });

function campaign(fields: string[]): string[] {
    return fields.length === 4 && fields.every(value => counter.test(value)) && fields.some(value => value !== '0') ? fields : [];
}

function sameCampaign(a: string[], b: string[]): boolean {
    return a.join('/') === b.join('/');
}

function lastIndex(records: string[][], matches: (fields: string[]) => boolean, end = records.length): number {
    for (let i = end - 1; i >= 0; i--) {
        if (matches(records[i])) return i;
    }
    return -1;
}

export function ceFrames(text: string): string[][] {
    const records = text.split(/\r?\n/).map(ceLogRecord).filter(record => record.length > 0);
    const load = lastIndex(records, fields => fields[0] === 'VOTC:CAMPAIGN' && fields[1] === 'loaded');
    return records.slice(load + 1);
}

function isInit(fields: string[]): boolean {
    return fields[0] === 'VOTC:IN' && fields[1] === 'init';
}

function isLetter(fields: string[]): boolean {
    return fields[0] === 'VOTC:LETTER' && /^(?:flag:)?letter_\d+$/.test(fields[2] ?? '');
}

function snapshot(records: string[][], end: number): { init: string[]; details: string[][] } | undefined {
    const start = lastIndex(records, isInit, end);
    if (start < 0) return;
    const init = records[start];
    if (!id.test(init[2]) || !id.test(init[4])) return;
    return { init, details: records.slice(start + 1, end).filter(fields => fields[0] === 'VOTC:IN') };
}

function senderFacts(details: string[][], sender: string): string[] {
    return details.filter(fields => fields[1] === 'memory' && fields[2] === sender)
        .slice(-6).map(fields => clean(fields[5])).filter(Boolean);
}

function letterFacts(init: string[], details: string[][], facts: string[]): CeIdentity & LetterFacts {
    return {
        player: init[2], playerName: clean(init[3]), sender: init[4], senderName: clean(init[5]),
        date: clean(init[6]), campaign: campaign(init.slice(19, 23)),
        facts: [...facts, ...senderFacts(details, init[4])],
    };
}

export function readCeRequest(records: string[][], command: string, payload: string[]): CeRequest | undefined {
    if (command === 'VOTC:INCOMING_LETTER') {
        const [slotId, type, delivery, player, protocol, version] = payload;
        const slot = slotId?.match(/^incoming_letter_([1-8])$/)?.[1];
        if (!slot || !flag.test(type) || !counter.test(delivery) || !id.test(player) || protocol !== '2' || version !== '1') return;
        const campaignId = campaign(payload.slice(6, 10));
        if (!campaignId.length) return;
        const clipboard = lastIndex(records, fields => fields[0] === command && fields[1] === 'clipboard' && fields[2] === slotId);
        if (clipboard < 0 || records[clipboard].slice(2, 12).join('/;/') !== payload.slice(0, 10).join('/;/')) return;
        const context = lastIndex(records, fields => fields[0] === command && fields[1] === 'context' && fields[2] === slotId, clipboard);
        const row = records[context];
        if (!row || row[3] !== type || row[6] !== delivery) return;
        const frame = snapshot(records, context);
        if (!frame || frame.init[2] !== player || frame.init[4] !== row[5] || frame.init[6] !== row[4] ||
            !sameCampaign(campaignId, campaign(frame.init.slice(19, 23)))) return;
        const sentDay = ceScriptDay(row[4]);
        if (!sentDay) return;
        return {
            ...letterFacts(frame.init, frame.details, row.slice(7, 21).map(value => clean(value)).filter(Boolean)),
            kind: 'incoming', file: `votc_ce_incomingletter_v2_${slot}.txt`, slot, type, delivery, sentDay,
        };
    }

    if (command === 'VOTC:WHISPER') {
        const index = lastIndex(records, fields => fields[0] === command && /^(3|6|12)\|(WORLD|REALM|COURT|CIRCLE)$/.test(fields[1] ?? ''));
        const row = records[index];
        if (!row || !id.test(row[2]) || !id.test(row[3])) return;
        const frame = snapshot(records, index);
        if (!frame || frame.init[7] !== 'flag:whisper_ledger' || frame.init[2] !== frame.init[4]) return;
        const section = row[1].split('|')[1];
        const groups = ['WORLD', 'REALM', 'COURT', 'CIRCLE'];
        const roles = ['whisper_foreign', 'whisper_realm', 'whisper_court', 'whisper_circle'];
        const step = groups.indexOf(section) + 1;
        const members = new Map(frame.details
            .filter(fields => fields[1] === 'character' && fields[27] === roles[step - 1])
            .map(fields => [fields[2], clean(fields[4])]));
        const facts = frame.details.filter(fields => fields[1] === 'memory' && members.has(fields[2]))
            .slice(-20).map(fields => `${members.get(fields[2])}: ${clean(fields[5])}`);
        return {
            kind: 'whisper', file: 'votc_ce_whisper.txt', player: frame.init[2], campaign: campaign(frame.init.slice(19, 23)),
            section, step, nonce: row[3], day: row[2], facts: [...new Set(facts)],
        };
    }

    if (command === 'VOTC:LETTER') {
        const index = lastIndex(records, fields => isLetter(fields) || (fields[0] === 'VOTC:IN' && fields[1] === 'letter_payload'));
        const row = records[index];
        if (!row || row[1] !== 'letter_payload' || !/^(lover|friend|rival|kin|liege|mentor|plain)$/.test(row[2])) return;
        const frame = snapshot(records, index);
        if (!frame || frame.init[7] !== 'flag:talk_letter') return;
        return { ...letterFacts(frame.init, frame.details, []), kind: 'npc', file: 'votc_ce_npcltr.txt', type: row[2] };
    }
}

export function lastCeIdentity(records: string[][]): CeIdentity | undefined {
    const init = records[lastIndex(records, isInit)];
    if (init && id.test(init[2])) return { player: init[2], campaign: campaign(init.slice(19, 23)) };
}
