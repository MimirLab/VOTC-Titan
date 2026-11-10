// Execute the emitted helper bodies over finite synthetic CK3 scopes. This
// catches relationship/scope and stale-receipt errors, not CK3 engine syntax.
import fs from 'fs';
import path from 'path';
import { parseCk3Script, ScriptEntry as Ck3Entry } from '../../src/main/culture/ck3Script';

type Person = { id: string; faith: string; land: string; jailer?: Person };
// The deployment test verifies these bytes against compile_admission(True), so
// the evaluator cannot silently exercise a different recipe from the compiler.
const emitted = fs.readFileSync(path.join(__dirname, 'fixtures/custody-admission.txt'), 'utf8');
const bodies = new Map(parseCk3Script(emitted).map(e => [e.key, e.value as Ck3Entry[]]));
function harness(actor: Person, recipient?: Person) {
    const globals = new Map<string, any>([['titan_scene_anchor', actor]]);
    if (recipient) globals.set('titan_scene_recipient', recipient);
    let pinned: Person[] = [], selected: Person[] = [], active: Person[] | undefined;
    const body = (e: Ck3Entry) => e.value as Ck3Entry[];
    const field = (e: Ck3Entry, k: string) => body(e).find(v => v.key === k)!.value as string;
    function value(token: any, current: Person, prev?: Person): any {
        if (token === 'this') return current;
        if (token === 'prev') return prev;
        if (token === 'yes') return true;
        if (token === 'no') return false;
        if (token === 'global_var:titan_scene_anchor.location.county.faith') return 'local';
        if (typeof token === 'string' && token.startsWith('global_var:')) return globals.get(token.slice(11));
        return token;
    }
    function matches(entries: Ck3Entry[], current: Person, prev?: Person): boolean {
        return entries.every(e => {
            const k = e.key!, v = e.value;
            if (k === 'OR') return body(e).some(child => matches([child], current, prev));
            if (k === 'AND') return matches(body(e), current, prev);
            if (k === 'NOT') return !matches(body(e), current, prev);
            if (k.startsWith('global_var:')) {
                const target = value(k, current, prev);
                return !!target && matches(body(e), target, current);
            }
            if (k === 'faith') return current.faith === value(v, current, prev);
            if (k === 'this') return current === value(v, current, prev);
            if (k === 'exists') return !!value(v, current, prev);
            if (k === 'is_at_same_location') return current.land === value(v, current, prev)?.land;
            if (k === 'is_imprisoned_by') return !!current.jailer && current.jailer === value(v, current, prev);
            if (k === 'has_global_variable') return globals.has(v as string);
            if (k === 'has_variable_list') return v === 'mcc_characters_selected' && selected.length > 0;
            if (k === 'has_global_variable_list') return v === 'mcc_characters_list_v2' && active !== undefined;
            if (k.startsWith('any_')) {
                const people = k === 'any_pinned_character' ? pinned : k === 'any_in_list' ? selected : active || [];
                return people.some(p => matches(body(e).filter(v => v.key !== 'variable'), p, current));
            }
            if (bodies.has(k)) return matches(bodies.get(k)!, current, prev) === value(v, current, prev);
            throw Error('Unsupported synthetic predicate: ' + k);
        });
    }
    function run(entries: Ck3Entry[], current: Person, prev?: Person) {
        let branchTaken = false;
        for (const e of entries) {
            const k = e.key!;
            if (k === 'if' || k === 'else_if') {
                if (k === 'if') branchTaken = false;
                if (!branchTaken && matches(body(e).find(x => x.key === 'limit')!.value as Ck3Entry[], current, prev)) {
                    run(body(e).filter(x => x.key !== 'limit'), current, prev); branchTaken = true;
                }
            } else if (k === 'set_global_variable') globals.set(field(e, 'name'), value(field(e, 'value'), current, prev));
            else if (k === 'remove_global_variable') globals.delete(e.value as string);
            else if (k.startsWith('global_var:')) {
                const target = value(k, current, prev); if (target) run(body(e), target, current);
            } else if (k.startsWith('every_')) {
                const people = k === 'every_pinned_character' ? pinned : k === 'every_in_list' ? selected : active || [];
                const limit = body(e).find(x => x.key === 'limit');
                for (const p of people) if (!limit || matches(limit.value as Ck3Entry[], p, current))
                    run(body(e).filter(x => !['limit', 'variable'].includes(x.key!)), p, current);
            } else if (bodies.has(k)) run(bodies.get(k)!, current, prev);
            else throw Error('Unsupported synthetic effect: ' + k);
        }
    }
    return {
        party(options: { pins?: Person[]; group?: Person[]; active?: Person[] }) {
            pinned = options.pins || []; active = options.active;
            if (options.group) { selected = options.group; globals.set('titan_scene_group_mode', true); }
            else { selected = []; globals.delete('titan_scene_group_mode'); }
        },
        check() {
            run(bodies.get('titan_prepare_scene_admission_effect')!, actor);
            expect(globals.has('titan_scene_admission_subject')).toBe(false);
            expect(globals.has('titan_scene_admission_failed')).toBe(false);
            return globals.has('titan_scene_faith_access');
        }
    };
}
const person = (id: string, faith = 'local', land = 'meeting'): Person => ({ id, faith, land });
test('both adherents qualify, and an absent primary cannot reuse admission', () => {
    expect(harness(person('player'), person('speaker')).check()).toBe(true);
    expect(harness(person('player')).check()).toBe(false);
});
test('actual custody works in either direction and expires on release', () => {
    const a = person('player'), b = person('speaker', 'other'); b.jailer = a;
    const h = harness(a, b); expect(h.check()).toBe(true);
    delete b.jailer; expect(h.check()).toBe(false);
    a.faith = 'other'; b.faith = 'local'; a.jailer = b;
    expect(harness(a, b).check()).toBe(true);
});
test('free outsiders, absent jailers and a jailer outside the local faith fail', () => {
    const a = person('player'), b = person('speaker', 'other');
    expect(harness(a, b).check()).toBe(false);
    b.jailer = person('absent'); expect(harness(a, b).check()).toBe(false);
    a.faith = 'other'; b.jailer = a; expect(harness(a, b).check()).toBe(false);
});
test('all actual participants qualify; group mode excludes unrelated pinned jailers', () => {
    const a = person('player'), b = person('speaker', 'other'), host = person('host'); b.jailer = host;
    const h = harness(a, b); h.party({ pins: [host] }); expect(h.check()).toBe(true);
    h.party({ pins: [host], group: [b] }); expect(h.check()).toBe(false);
    h.party({ pins: [host], group: [b, host], active: [b, host] }); expect(h.check()).toBe(true);
    h.party({ group: [b, host, person('unheld', 'other')] }); expect(h.check()).toBe(false);
});
test('a remote selected participant or jailer fails while an unrelated remote pin stays irrelevant', () => {
    const a = person('player'), b = person('speaker', 'other'); b.jailer = a;
    const remote = person('remote', 'other', 'elsewhere');
    const h = harness(a, b); h.party({ pins: [remote] }); expect(h.check()).toBe(true);
    h.party({ group: [remote] }); expect(h.check()).toBe(false);
    const jailer = person('remote-jailer', 'local', 'elsewhere'); b.jailer = jailer;
    const jailerParty = harness(a, b); jailerParty.party({ active: [jailer] });
    expect(jailerParty.check()).toBe(false);
    b.land = 'elsewhere'; expect(harness(a, b).check()).toBe(false);
});
