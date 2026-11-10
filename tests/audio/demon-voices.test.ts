import fs from 'fs';
import { app } from 'electron';
import path from 'path';
import { demonFamily, demonDirection, isDemonFamily, WHISPER_DIRECTION } from '../../src/main/audio/demonVoices';
import { acousticDelivery } from '../../src/main/audio/acousticDelivery';
import { composeVoiceDesign, VoiceCasting } from '../../src/main/audio/acousticCasting';
import { cloneDelivery } from '../../src/main/audio/CloneBanks';

beforeEach(() => { (app as any).getAppPath = () => path.resolve('.'); });
const families = ['dreadlord', 'eredar', 'doomguard', 'pitlord', 'imp', 'satyr', 'sayaad', 'shivarra', 'observer', 'voidwalker', 'felorc', 'felblood', 'metamorphosis'] as const;
test('demon performance families have distinct bounded speech and breath directions', () => {
    expect(new Set(families.map(f => demonDirection(f))).size).toBe(families.length);
    expect(new Set(families.map(f => demonDirection(f, true))).size).toBe(families.length);
    for (const family of families) {
        expect(isDemonFamily(family)).toBe(true);
        expect(demonDirection(family).length).toBeLessThan(220);
        expect(demonDirection(family, true)).toMatch(/breath|whisper/);
    }
    for (const invalid of ['__proto__', 'human', 'demon', 'constructor', null]) expect(isDemonFamily(invalid)).toBe(false);
    expect(demonDirection(undefined)).toBe('');
});
test.each([
    ['085','creature_nathrezim','dreadlord'], ['086','creature_manari','eredar'], ['084','creature_eredruin','doomguard'],
    ['088','creature_annihilan','pitlord'], ['091','creature_imp','imp'], ['034','creature_satyr','satyr'],
    ['092','creature_sayaadi','sayaad'], ['189','creature_shivarra','shivarra'], ['185','creature_observer','observer'],
    ['093','creature_voidwalker','voidwalker'], ['013','creature_fel_orc','felorc'], ['166','creature_high_elf','felblood']
])('Race %s selects its own vocal performance independently of culture', (anatomyId, body, family) => {
    expect(demonFamily({anatomyId,body})).toBe(family);
    const text = 'The copper lantern is safe.';
    const speech = acousticDelivery({kind:'speech',text,passage:0},'Adult.',{voice:{anatomyId,body,sex:'male'}});
    expect(speech.renderText).toBe(text); expect(speech.instruction).toContain(demonDirection(family as typeof families[number]));
    const thought = acousticDelivery({kind:'thought',text,passage:0},'Adult.',{voice:{anatomyId,body,sex:'male'}});
    expect(thought.renderText).toBe(text); expect(thought.instruction).toContain(WHISPER_DIRECTION);
    expect(thought.instruction).toContain(demonDirection(family as typeof families[number],true));
    expect(acousticDelivery({kind:'narration',text,passage:0},'Adult.',{voice:{anatomyId,body}}).instruction)
        .toBe('Consistent, clear storytelling narration.');
    expect(demonFamily({anatomyId:'001',body})).toBeUndefined();
});
test('new demon reference designs retain separate culture, Sex and individual identity; existing normal clones retain their delivery', () => {
    const base = {version:'test',sourceSha256:'test',anatomyId:'085',anatomyCore:'A female low mezzo with hollow resonance.',
        cultureCore:'Use a learned Jamaican accent.',formKey:'stable',explicit:false} as VoiceCasting;
    const instruction = composeVoiceDesign(base,'Dry consonants and narrow vowels.');
    for(const part of [base.anatomyCore,base.cultureCore,'Dry consonants and narrow vowels.',demonDirection('dreadlord')]) expect(instruction).toContain(part);
    expect(() => composeVoiceDesign(base,'a'.repeat(2400))).toThrow('too long');
    const segment={kind:'speech' as const,text:'The copper lantern is safe.',passage:0};
    expect(cloneDelivery(segment,'calm')).toEqual({renderText:segment.text,instruction:'calm'});
    expect(cloneDelivery(segment,'calm','dreadlord').instruction).toBe('calm');
    expect(cloneDelivery({...segment,kind:'thought'},'calm','dreadlord').instruction).toContain(WHISPER_DIRECTION);
});
test('bundled demon coloration is explicit and preserves every identity/default/form and reference manifest', () => {
    const c=JSON.parse(fs.readFileSync(path.resolve('public/audio/clone-banks/catalog.json'),'utf8'));
    const colored=Object.entries(c.profiles).filter(([,p])=>(p as any).performanceFamily) as [string,any][];
    expect(colored).toHaveLength(15);
    for(const [key,p] of colored) {
        expect(isDemonFamily(p.performanceFamily)).toBe(true);
        expect(fs.existsSync(path.resolve('public/audio/clone-banks',key,'reference.wav'))).toBe(true);
    }
    expect(c.profiles['goa2-340009-hots-illidan/v0001'].performanceFamily).toBeUndefined();
    expect(c.profiles['goa2-340009-wc3-illidanmorphed/v0001'].performanceFamily).toBe('metamorphosis');
    expect(Object.keys(c.identities)).toHaveLength(407);
    expect(Object.values(c.identities).every((v:any)=>v.keys.includes(v.defaultKey))).toBe(true);
});

test('every demon family is ignored by clone delivery while generated speech and thoughts keep it',()=>{
    for(const family of families)for(const kind of ['speech','thought'] as const){
        const segment={kind,text:'The copper lantern is safe.',passage:0};
        const ordinary=cloneDelivery(segment,'Cautious, measured.',undefined,'older');
        const named=cloneDelivery(segment,'Cautious, measured.',family,'older');
        expect(named).toEqual(ordinary);
        expect(named.instruction).not.toContain(demonDirection(family,kind==='thought'));
        if(kind==='thought')expect(named.instruction).toContain(WHISPER_DIRECTION);
    }
});
