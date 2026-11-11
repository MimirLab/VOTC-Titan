import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Config } from '../shared/Config';
import { ApiConnection } from '../shared/apiConnection';
import { BattleReportGenerator } from './battleReport/BattleReportGenerator';
import { ceRunnerFiles } from './ceBridge';
import { CeRequest, ceFrames, ceLogRecord, ceScriptDay, lastCeIdentity, readCeLog, readCeRequest } from './ceRequestLog';
import { ceBattleScript, ceIncomingProbe, ceRequestScript } from './ceRequestScript';

type PendingArrival = { marker: string; probe: string; delivery: string };
type RunFile = { path: string; script: string; receipt: string; arrival?: PendingArrival; timer?: NodeJS.Timeout };
const arrivalRetryMs = 10_000;
const pendingPrefix = '\uFEFF# titan-ce-incoming ';
type Generate = (prompt: string, config: Config, signal: AbortSignal) => Promise<string>;

const languageNames = new Intl.DisplayNames(['en'], { type: 'language' });

function letterPrompt(request: Exclude<CeRequest, { kind: 'whisper' }>, language: string): string {
    const genre = request.type.replace(/_/g, ' ');
    return [
        `Write an in-character ${genre} letter in ${language}, from ${request.senderName} to ${request.playerName}.`,
        'Use at most 180 words. Return only the letter. Use the supplied facts where relevant. Keep unrecorded events, plans, promises, and relationships out of the letter.',
        JSON.stringify({ date: request.date, facts: request.facts }),
    ].join('\n');
}

function fallback(request: CeRequest, language: string): string {
    if (request.kind === 'whisper') {
        if (request.facts.length) return request.facts.slice(-5).join('\n');
        return language === 'zh' ? '这一部分没有可靠的消息。' : 'The keeper has no verified news for this section.';
    }
    if (request.facts.length) return request.facts.join('\n');
    return language === 'zh' ? `致${request.playerName}，谨致问候。\n${request.senderName}`
        : `${request.playerName},\nI send my greetings.\n${request.senderName}`;
}

async function generateProse(prompt: string, config: Config, signal: AbortSignal): Promise<string> {
    const { connection, parameters } = config.textGenerationApiConnectionConfig;
    const api = new ApiConnection(connection, parameters, null, 'background-resumable');
    const result = await api.complete([{ role: 'user', content: prompt }], false,
        { max_tokens: Math.min(config.maxTokens || 600, 600) }, undefined, signal, 90_000);
    return (typeof result === 'string' ? result : result?.content ?? '').trim();
}

export class CeCompatibility {
    private session = new AbortController();
    private readonly queued = new Map<string, string>();
    private readonly written = new Map<string, RunFile>();
    private readonly complete = new Map<string, string>();

    constructor(private readonly generate: Generate = generateProse) {}

    reset(): void {
        this.session.abort();
        this.session = new AbortController();
        this.queued.clear();
        this.complete.clear();
        for (const file of this.written.values()) this.clear(file);
        this.written.clear();
    }

    observeLog(line: string): void {
        const [command, result, name, receipt] = ceLogRecord(line);
        if (command !== 'VOTC:CE_COMPAT') return;
        const file = this.written.get(name);
        if (!file || !receipt || file.receipt !== receipt) return;
        if (result === 'applied' || result === 'stale') {
            this.clear(file);
            this.written.delete(name);
            return;
        }
        const arrival = file.arrival;
        if (!arrival) return;
        const probing = file.script === arrival.marker + arrival.probe;
        const delivering = file.script === arrival.marker + arrival.delivery;
        const deliveryBusy = [...this.written.values()].some(current =>
            current.arrival && current.script === current.arrival.marker + current.arrival.delivery);
        if (probing && result === 'ready' && !deliveryBusy) {
            this.replace(file, arrival.marker + arrival.delivery);
        } else if (((probing && (result === 'waiting' || result === 'ready')) ||
            (delivering && result === 'blocked')) && this.replace(file, arrival.marker)) {
            file.timer = setTimeout(() => {
                if (this.written.get(name) === file) this.replace(file, arrival.marker + arrival.probe);
            }, arrivalRetryMs);
            file.timer.unref();
        }
    }

    // An idle comment retains the response across companion restarts. CK3
    // reads no prose or effects from the file while the letter is in transit.
    resume(folder: string): void {
        if (!folder) return;
        for (let slot = 1; slot <= 8; slot++) {
            const name = `votc_ce_incomingletter_v2_${slot}.txt`;
            const filePath = path.join(folder, 'run', name);
            try {
                if (!fs.existsSync(filePath) || fs.statSync(filePath).size > 32_768) continue;
                const script = fs.readFileSync(filePath, 'utf8');
                if (!script.startsWith(pendingPrefix)) continue;
                const end = script.indexOf('\n') + 1;
                if (!end) continue;
                const marker = script.slice(0, end);
                const [receipt, probe, delivery] = marker.slice(pendingPrefix.length).trim().split(' ');
                if (!/^[a-f0-9-]{36}$/.test(receipt) || !probe || !delivery) continue;
                const arrival = { marker, probe: Buffer.from(probe, 'base64').toString(), delivery: Buffer.from(delivery, 'base64').toString() };
                const file = { path: filePath, script, receipt, arrival };
                if (this.replace(file, marker + arrival.probe)) this.written.set(name, file);
            } catch {
                console.warn('CE compatibility could not resume a pending incoming letter.');
            }
        }
    }

    private replace(file: RunFile, script: string): boolean {
        try {
            if (fs.readFileSync(file.path, 'utf8') !== file.script) return false;
            this.write(file.path, script);
            file.script = script;
            return true;
        } catch {
            console.warn('CE compatibility could not update a pending run file.');
            return false;
        }
    }

    private clear(file: RunFile): void {
        clearTimeout(file.timer);
        this.replace(file, '\uFEFF');
    }

    private write(file: string, text: string): void {
        const pending = `${file}.${randomUUID()}.tmp`;
        try {
            fs.writeFileSync(pending, text, { flag: 'wx', mode: 0o600 });
            fs.renameSync(pending, file);
        } finally {
            fs.rmSync(pending, { force: true });
        }
    }

    private stage(folder: string, name: string, script: string, receipt: string, probe?: string): void {
        const run = path.join(folder, 'run');
        fs.mkdirSync(run, { recursive: true });
        const filePath = path.join(run, name);
        const arrival = probe ? {
            marker: `${pendingPrefix}${receipt} ${Buffer.from(probe).toString('base64')} ${Buffer.from(script).toString('base64')}\n`,
            probe, delivery: script,
        } : undefined;
        const encoded = arrival ? arrival.marker + arrival.probe : '\uFEFF' + script;
        this.write(filePath, encoded);
        clearTimeout(this.written.get(name)?.timer);
        this.written.set(name, { path: filePath, script: encoded, receipt, arrival });
    }

    async dispatch(command: string, payload: string[], config: Config, userDataPath: string): Promise<boolean> {
        const isOrdinaryLetter = command === 'VOTC:LETTER';
        const folder = config.userFolderPath;
        if (!folder) return !isOrdinaryLetter;
        const session = this.session.signal;
        let request: CeRequest | undefined;
        try {
            const records = ceFrames(await readCeLog(folder));
            if (session.aborted) return true;
            if (command === 'VOTC:BATTLE_REPORT') {
                const runners = ceRunnerFiles(folder);
                const identity = lastCeIdentity(records);
                const generator = new BattleReportGenerator(config, userDataPath);
                const battleRecords = records.filter(fields => fields[0] === command).map(fields => fields.join('/;/')).join('\n');
                for (const battle of generator.prepareCompatibilityReports(battleRecords)) {
                    if (identity && identity.player !== battle.player) continue;
                    const file = battle.legacySingleSlot ? 'battle_report.txt' : `battle_report${battle.slot}.txt`;
                    const day = ceScriptDay(battle.date);
                    const signature = JSON.stringify([battle, identity]);
                    if (!day || !runners.includes(file) || this.complete.get(file) === signature) continue;
                    const receipt = randomUUID();
                    this.stage(folder, file, ceBattleScript(identity ?? { player: battle.player, campaign: [] },
                        battle.slot, day, battle.text, file, receipt), receipt);
                    this.complete.set(file, signature);
                }
                return true;
            }

            request = readCeRequest(records, command, payload);
            if (!request) return !isOrdinaryLetter;
            const { file } = request;
            if (!ceRunnerFiles(folder).includes(file)) return true;
            const signature = JSON.stringify(request);
            if (this.queued.get(file) === signature || this.complete.get(file) === signature) return true;
            this.queued.set(file, signature);

            const locale = config.language || 'en';
            const language = languageNames.of(locale) ?? 'English';
            const prompt = request.kind === 'whisper'
                ? `Write the ${request.section} section of a ruler's intelligence ledger in ${language}. Use at most 150 words. Summarize only the supplied observations. Do not invent news or name anyone outside the observations.\n${JSON.stringify(request.facts)}`
                : letterPrompt(request, language);
            let text = '';
            try {
                if (request.kind !== 'whisper' || request.facts.length) {
                    text = await this.generate(prompt, config, AbortSignal.any([session, AbortSignal.timeout(120_000)]));
                }
            } catch {
                if (!session.aborted) console.warn('CE compatibility is using recorded facts after a text request failed.');
            }
            if (session.aborted || this.queued.get(file) !== signature || config.userFolderPath !== folder) return true;
            const receipt = randomUUID();
            const script = ceRequestScript(request, text || fallback(request, locale), receipt);
            const probe = request.kind === 'incoming' ? ceIncomingProbe(request, receipt) : undefined;
            this.stage(folder, file, script, receipt, probe);
            this.queued.delete(file);
            this.complete.set(file, signature);
            return true;
        } catch {
            if (request && this.queued.get(request.file) === JSON.stringify(request)) this.queued.delete(request.file);
            if (!session.aborted) console.warn('CE compatibility could not read or stage a game request.');
            return !isOrdinaryLetter || !!request;
        }
    }
}
