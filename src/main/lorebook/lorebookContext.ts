import type { GameData } from '../../shared/gameData/GameData';
import { validateCk3GameDate } from '../../shared/gameData/gameDate';
import { requireCampaignIdentity } from '../campaignIdentityResolver';
import { buildContextFromGameData } from '../timelineManager';

export interface LoreReport {
    origin: 'user_reported'; campaign_id: string; timeline_id: string;
    start_date: string; as_of: string; mod_version: string; choices: unknown[];
    lore_knowledge: { actor_id: string; as_of: string; setting_sha256: string; known_subjects: string[] };
    [key: string]: unknown;
}

export function encounterLoreIdentity(game: GameData, actorId: number): { campaign: string; timeline: string; actor: string; date: string } {
    if (!game.gameDate || !validateCk3GameDate(game.gameDate).valid)
        throw new Error('A valid numeric game clock is required for campaign lore.');
    const identity = requireCampaignIdentity(game);
    const timeline = buildContextFromGameData(game).timelineNodeId;
    if (!timeline || !game.characters.has(actorId)) throw new Error('Campaign lore needs the actual timeline and character.');
    const d = game.gameDate;
    return { campaign: identity.campaignId, timeline, actor: String(actorId),
        date: `${String(d.year).padStart(4, '0')}-${String(d.month).padStart(2, '0')}-${String(d.day).padStart(2, '0')}` };
}

/** Knowledge never travels to another actor/save fork or backwards past its report. */
export function projectLoreReport(report: LoreReport, game: GameData, actorId: number, setting: string): LoreReport {
    const actual = encounterLoreIdentity(game, actorId);
    if (report.origin !== 'user_reported' || report.campaign_id !== actual.campaign || report.timeline_id !== actual.timeline ||
        report.lore_knowledge?.actor_id !== actual.actor || report.lore_knowledge?.setting_sha256 !== setting)
        throw new Error('The knowledge report belongs to another character, campaign, timeline or edition.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(report.as_of) || report.as_of > actual.date || report.lore_knowledge.as_of !== report.as_of)
        throw new Error('Knowledge cannot be reused before its reported date.');
    if (!Array.isArray(report.choices) || report.choices.some((v: any) => typeof v?.occurred_at !== 'string' || v.occurred_at > actual.date))
        throw new Error('A selected choice is outside the actual game clock.');
    return { ...report, as_of: actual.date, lore_knowledge: { ...report.lore_knowledge, as_of: actual.date } };
}
