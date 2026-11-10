import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
import { bindObservedTurningContexts, rememberedTurningNotes } from '../../src/main/lorebook/loreMutationDisclosure';

// Actual bundled-worker output from a synthetic current-save capture. This
// fixture verifies transport/binding, not CK3 execution or acoustic/RP quality.
const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/mutation-applicability.json'), 'utf8'));
const fresh = () => JSON.parse(JSON.stringify(fixture));

test('the root account and separately requested child retain their exact source and dated applicability', () => {
    const f = fresh();
    const contexts = bindObservedTurningContexts([...f.passages, ...f.deeper], f.context, f.catalogue);
    expect(contexts).toHaveLength(2);
    expect(contexts[0]).toMatchObject({ stage: 'choice', occurredAt: '0603-01-01' });
    expect(contexts[1].account).toBe(f.deeper[0].heading + '\n' + f.deeper[0].text);
    const notes = rememberedTurningNotes(contexts);
    expect(notes.match(/recorded on/g)).toHaveLength(1);
    expect(notes).toContain('selected choices do not prove their later success');
    expect(notes).toContain('Keep this context private');
});

test.each(['actor', 'owner', 'date', 'kind', 'phase', 'source', 'node', 'heading', 'body', 'catalogue'])
('a changed %s cannot become character knowledge', field => {
    const f = fresh(), p = f.passages[0], v = p.observed_turning;
    if (field === 'actor') v.actor_id = '3';
    if (field === 'owner') v.owner = 'fallen';
    if (field === 'date') v.occurred_at = '0603-01-02';
    if (field === 'kind') v.account_kind = 'coded_resolution';
    if (field === 'phase') v.phase = 'duel_callback_completed';
    if (field === 'source') v.execution_definition_sha256 = 'f'.repeat(64);
    if (field === 'node') { p.node_id += ':unwritten'; v.node_id = p.node_id; }
    if (field === 'heading') p.heading = 'The plague is cured';
    if (field === 'body') {
        p.text = 'The plague was cured immediately.';
        v.body_sha256 = createHash('sha256').update(p.text).digest('hex');
    }
    if (field === 'catalogue') f.context.mutation_digest = 'f'.repeat(64);
    expect(() => bindObservedTurningContexts([p], f.context, f.catalogue)).toThrow();
});

test('an ordinary admitted passage needs no fabricated turning receipt', () => {
    const f = fresh(); delete f.passages[0].observed_turning;
    expect(bindObservedTurningContexts(f.passages, f.context, f.catalogue)).toEqual([]);
    expect(rememberedTurningNotes([])).toBe('');
});
