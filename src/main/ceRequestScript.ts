import { CeIdentity, CeRequest } from './ceRequestLog';

export function ceGameText(text: string): string {
    return text.trim().slice(0, 4000)
        .replace(/[\x00-\x09\x0b-\x1f]/g, ' ')
        .replace(/\\/g, '／').replace(/"/g, '”')
        .replace(/[\[\]$#]/g, character => ({'[': '［', ']': '］', '$': '＄', '#': '＃'}[character]!))
        .replace(/\n/g, '\\n');
}

function campaignConditions(identity: CeIdentity): string[] {
    return identity.campaign.map((value, index) => `global_var:votc_campaign_id_${'abcd'[index]} = ${value}`);
}

function guarded(identity: CeIdentity, conditions: string[], effects: string[], otherwise?: string): string {
    return [
        'root = {',
        '    if = {',
        '        limit = {',
        ...['is_ai = no', ...campaignConditions(identity), ...conditions].map(line => `            ${line}`),
        '        }',
        ...effects.map(line => `        ${line}`),
        '    }',
        ...(otherwise ? [`    else = { ${otherwise} }`] : []),
        '}',
        '',
    ].join('\n');
}

function artifact(title: string, body: string, creator: string): string[] {
    return [
        'create_artifact = {',
        `    name = ${title}`,
        `    description = "${ceGameText(body)}"`,
        '    type = journal',
        '    visuals = scroll',
        `    creator = ${creator}`,
        '    modifier = artifact_monthly_minor_prestige_1_modifier',
        '    wealth = 0',
        '    save_scope_as = titan_ce_artifact',
        '}',
    ];
}

function afterArtifact(effects: string[]): string[] {
    return ['if = {', '    limit = { exists = scope:titan_ce_artifact }',
        ...effects.map(line => `    ${line}`), '}'];
}

const parchmentFree = [
    'NOT = { exists = global_var:talk_scene }',
    'NOT = { exists = global_var:votc_incoming_letter_popup }',
    'NOT = { exists = global_var:votc_letter_replying }',
    'NAND = { exists = global_var:votc_latest_letter exists = global_var:votc_letter_replyable }',
];

type IncomingRequest = Extract<CeRequest, { kind: 'incoming' }>;

function incomingIdentity(request: IncomingRequest): string[] {
    const {slot, type, delivery, sentDay} = request;
    const name = `votc_incoming_letter_${slot}`;
    return [
        'this = global_var:votc_incoming_letter_player_scope',
        `exists = global_var:${name}`,
        `exists = global_var:votc_incoming_letter_sender_${slot}`,
        `global_var:votc_incoming_letter_type_${slot} = flag:${type}`,
        `has_variable = ${name}_delivery_id`,
        `var:${name}_delivery_id = ${delivery}`,
        `var:${name}_sent_day = ${sentDay}`,
    ];
}

function incomingArrival(request: IncomingRequest): string[] {
    return [...parchmentFree, `NOT = { has_variable = votc_incoming_letter_${request.slot}_timer }`];
}

function receiptLog(file: string, receipt: string, status: string): string {
    return `debug_log = "VOTC:CE_COMPAT/;/${status}/;/${file}/;/${receipt}"`;
}

export function ceIncomingProbe(request: IncomingRequest, receipt: string): string {
    return guarded(request, incomingIdentity(request), [
        'if = {',
        `    limit = { ${incomingArrival(request).join(' ')} }`,
        `    ${receiptLog(request.file, receipt, 'ready')}`,
        '}',
        `else = { ${receiptLog(request.file, receipt, 'waiting')} }`,
    ], receiptLog(request.file, receipt, 'stale'));
}

export function ceRequestScript(request: CeRequest, prose: string, receipt: string): string {
    const delivered = receiptLog(request.file, receipt, 'applied');
    if (request.kind === 'whisper') {
        return guarded(request, [
            'exists = global_var:votc_whisper_pending',
            'this = global_var:votc_whisper_player',
            `global_var:votc_whisper_req_id = ${request.nonce}`,
            `global_var:votc_whisper_step = ${request.step}`,
            `NOT = { global_var:votc_whisper_consumed_id = ${request.nonce} }`,
        ], [
            ...artifact('votc_whisper.20.title', prose, 'this'),
            ...afterArtifact([
                'set_global_variable = { name = votc_whisper_latest value = scope:titan_ce_artifact }',
                `set_global_variable = { name = votc_whisper_consumed_id value = ${request.nonce} }`,
                'remove_global_variable ?= votc_whisper',
                delivered,
                'trigger_event = votc_whisper.30',
            ]),
        ]);
    }

    const incoming = request.kind === 'incoming';
    const slot = incoming ? request.slot : '';
    const name = incoming ? `votc_incoming_letter_${slot}` : 'votc_npcltr';
    const sender = incoming ? `votc_incoming_letter_sender_${slot}` : 'message_second_scope_npcltr';
    const title = incoming ? `votc_incoming_letter_title${slot}` : 'votc_huixin_titlenpcltr';
    const incomingEffects = request.kind === 'incoming' ? [
        `set_global_variable = { name = message_second_scope value = global_var:${sender} }`,
        'set_global_variable = { name = votc_incoming_letter_popup value = yes }',
        `set_variable = { name = votc_incoming_reply_slot value = ${slot} days = 60 }`,
        `set_variable = { name = votc_incoming_reply_type value = flag:${request.type} days = 60 }`,
        `set_variable = { name = votc_incoming_reply_delivery value = ${request.delivery} days = 60 }`,
        `remove_global_variable ?= ${sender}`,
        `remove_global_variable ?= votc_incoming_letter_type_${slot}`,
        `remove_variable ?= ${name}_delivery_id`,
        `remove_variable ?= ${name}_sent_day`,
    ] : [
        'remove_variable ?= votc_incoming_reply_slot',
        'remove_variable ?= votc_incoming_reply_type',
        'remove_variable ?= votc_incoming_reply_delivery',
        'trigger_event = votc_ce_initiative.152',
    ];
    const conditions = request.kind === 'incoming'
        ? [...incomingIdentity(request), ...incomingArrival(request)]
        : [...parchmentFree, 'this = global_var:votc_ce_initiative_letter_player',
            `exists = global_var:${name}`, `exists = global_var:${sender}`];
    return guarded(request, conditions, [
        ...artifact(title, prose, `global_var:${sender}`),
        ...afterArtifact([
            'scope:titan_ce_artifact = { set_variable = { name = votc_letter_artifact value = yes } }',
            'set_global_variable = { name = votc_latest_letter value = scope:titan_ce_artifact }',
            `remove_global_variable ?= ${name}`,
            ...incomingEffects,
            delivered,
        ]),
    ], incoming ? receiptLog(request.file, receipt, 'blocked') : undefined);
}

export function ceBattleScript(identity: CeIdentity, slot: string, day: number, prose: string, file: string, receipt: string): string {
    const name = `votc_battle_report_${slot}`;
    const title = 'votc_battle_report_message_title';
    return guarded(identity, [`exists = global_var:${name}`, `var:${name}_sent_day = ${day}`], [
        ...artifact(title, prose, 'this'),
        ...afterArtifact([
            'send_interface_message = {',
            '    type = votc_message_popup',
            `    title = ${title}`,
            `    desc = "${ceGameText(prose)}"`,
            '}',
            `remove_global_variable ?= ${name}`,
            `remove_variable ?= ${name}_timer`,
            `remove_variable ?= ${name}_sent_day`,
            `debug_log = "VOTC:CE_COMPAT/;/applied/;/${file}/;/${receipt}"`,
        ]),
    ]);
}
