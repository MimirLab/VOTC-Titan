import { readFileSync } from 'fs';
import { join } from 'path';
import { LoreMutationLogReader } from '../../src/main/lorebook/loreMutationCapture';

const fixture = JSON.parse(readFileSync(join(__dirname, 'fixtures/mutation-engine-capture.json'), 'utf8'));

test('the real CK3 event/capture frame admits the owned memory without a guessed date conversion', () => {
    const reader = new LoreMutationLogReader(fixture.catalogue);
    fixture.lines.forEach((line: string) => reader.observeLine(line));
    expect(fixture.actualEngineExecution).toBe(true);
    expect(fixture.actualOriginalGoABranchExecution).toBe(false);
    expect(fixture.lines.some((line: string) => line.includes('/;/caller_memory_preserved'))).toBe(true);
    expect(reader.observations.size).toBe(1);
    const snapshot = [...reader.observations.values()][0];
    expect(Object.keys(snapshot.world)).toHaveLength(159);
    expect(snapshot.date).toEqual({ totalDays: 212796, year: 583, month: 1, day: 1, display: '583.1.1' });
    expect(snapshot.memories).toHaveLength(1);
    const memory = snapshot.memories[0];
    expect(memory.actorId).toBe(snapshot.characterId);
    expect(memory.date).toEqual(snapshot.date);
    expect(snapshot.world[memory.token]).toBe(212795);
});
