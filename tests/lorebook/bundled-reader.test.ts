import { LorebookClient } from '../../src/main/lorebook/lorebookClient';
import path from 'path';

const client = new LorebookClient(path.resolve(__dirname, '../..'));
afterAll(() => client.close());
test('the standalone bundled reader searches and opens nested accounts without a web service', async () => {
    const status = await client.request<any>({ op: 'status' });
    expect(status.ready).toBe(true); expect(Object.values(status.counts.passages).reduce((a: number, b: any) => a + b, 0)).toBe(37026);
    const found = await client.request<any>({ op: 'search', query: 'Ironforge', limit: 1 });
    expect(found.entries[0].title).toBe('Ironforge');
    const value = await client.request<any>({ op: 'read', node_id: found.entries[0].node_id });
    expect(value.children.length).toBeGreaterThan(0); expect(value.text.length).toBeGreaterThan(30);
    await expect(client.request({ op: 'resolve', context: { origin: 'synthetic_test' }, candidate_ids: [] })).rejects.toThrow('explicit reported');
    await expect(client.request({ op: 'resolve', context: {} })).rejects.toThrow('explicit reported');
    const candidates = await client.request<any>({ op: 'candidates', query: 'What customs guide apprentices in Ironforge?' });
    expect(candidates.ids.length).toBeGreaterThan(0); expect(candidates.ids.length).toBeLessThanOrEqual(40);
}, 30000);
