import { AudioPipeline } from '../../src/main/audio/AudioPipeline';
const tick = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(check: () => boolean) { for (let n = 0; n < 40 && !check(); n++) await tick(); expect(check()).toBe(true); }

test('one synthesis lane produces all available passages without waiting for playback boundaries', async () => {
    const controller = new AbortController(), requests: number[] = [], delivered: number[][] = [[], [], [], []];
    let active = 0, maximum = 0;
    const pipeline = new AudioPipeline(4, async (index, receive) => {
        requests.push(index); active++; maximum = Math.max(maximum, active);
        await tick(); await receive(Buffer.from([index])); active--;
    }, controller.signal);
    pipeline.connect(0, bytes => delivered[0].push(...bytes));
    await pipeline.finished;
    expect(requests).toEqual([0, 1, 2, 3]); expect(maximum).toBe(1);
    expect(delivered).toEqual([[0], [], [], []]); expect(pipeline.state().bufferedBytes).toBe(3);
    for (let index = 1; index < 4; index++) pipeline.connect(index, bytes => delivered[index].push(...bytes));
    expect(delivered).toEqual([[0], [1], [2], [3]]); expect(pipeline.state().bufferedBytes).toBe(0);
});
test('a full memory budget delays the next request until playback drains queued audio', async () => {
    const controller = new AbortController(), requests: number[] = [], delivered: Buffer[] = [];
    const pipeline = new AudioPipeline(3, async (index, receive) => {
        requests.push(index); await receive(Buffer.alloc(index === 1 ? 8 : 2, index));
    }, controller.signal, () => {}, 8);
    pipeline.connect(0, () => {});
    await until(() => pipeline.state().waiting);
    expect(requests).toEqual([0, 1]); expect(pipeline.state().bufferedBytes).toBe(8);
    pipeline.connect(1, bytes => delivered.push(bytes)); await pipeline.finished;
    expect(Buffer.concat(delivered)).toEqual(Buffer.alloc(8, 1));
    expect(requests).toEqual([0, 1, 2]); expect(pipeline.state().bufferedBytes).toBe(2);
});
test('a large incoming chunk obeys the budget then switches to live forwarding without loss or duplication', async () => {
    const controller = new AbortController(), expected = Buffer.from(Array.from({ length: 31 }, (_, i) => i));
    const delivered: Buffer[] = [];
    const pipeline = new AudioPipeline(2, async (index, receive) => {
        await receive(index ? expected : Buffer.from([99]));
    }, controller.signal, () => {}, 4);
    pipeline.connect(0, () => {}); await until(() => pipeline.state().waiting);
    expect(pipeline.state().bufferedBytes).toBe(4);
    pipeline.connect(1, bytes => delivered.push(bytes)); await pipeline.finished;
    expect(Buffer.concat(delivered)).toEqual(expected); expect(pipeline.state().bufferedBytes).toBe(0);
});
test('abort releases a full-buffer wait and rejects all unfinished passages', async () => {
    const controller = new AbortController(), requests: number[] = [];
    const pipeline = new AudioPipeline(3, async (index, receive) => {
        requests.push(index); await receive(Buffer.alloc(index ? 8 : 1));
    }, controller.signal, () => {}, 4);
    pipeline.connect(0, () => {}); await until(() => pipeline.state().waiting);
    controller.abort(); await pipeline.finished;
    await expect(pipeline.passage(1).done).rejects.toThrow();
    await expect(pipeline.passage(2).done).rejects.toThrow();
    expect(requests).toEqual([0, 1]); expect(pipeline.state().bufferedBytes).toBeLessThanOrEqual(4);
});
test('a future failure leaves completed audio available and rejects later passages without generating them', async () => {
    const controller = new AbortController(), requests: number[] = [];
    const pipeline = new AudioPipeline(3, async (index, receive) => {
        requests.push(index); if (index === 1) throw new Error('Synthetic generation failure');
        await receive(Buffer.from([1, 2]));
    }, controller.signal);
    await pipeline.finished;
    const delivered: Buffer[] = []; pipeline.connect(0, bytes => delivered.push(bytes));
    await expect(pipeline.passage(0).done).resolves.toBeUndefined();
    await expect(pipeline.passage(1).done).rejects.toThrow('Synthetic generation failure');
    await expect(pipeline.passage(2).done).rejects.toThrow('Synthetic generation failure');
    expect(Buffer.concat(delivered)).toEqual(Buffer.from([1, 2])); expect(requests).toEqual([0, 1]);
});
