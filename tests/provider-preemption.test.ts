import { ProviderLane, textProviderLane } from '../src/shared/providerActivity';
import { ApiConnection } from '../src/shared/apiConnection';

const settle = async () => { for (let tick = 0; tick < 20; tick++) await Promise.resolve(); };
const aborted = (signal: AbortSignal): Promise<string> => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(Object.assign(new Error('Synthetic abort'), { name: 'AbortError' })), { once: true });
});

test('resumable closing work waits for transport cleanup and all foreground requests before retrying', async () => {
    const lane = new ProviderLane(), order: string[] = [];
    let attempts = 0, releaseTransport!: () => void;
    const background = lane.run('background-resumable', signal => {
        order.push('background-' + ++attempts);
        if (attempts > 1) return Promise.resolve('complete');
        return new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => {
            order.push('abort'); releaseTransport = () => reject(new Error('Transport stopped'));
        }, { once: true }));
    });
    await settle();
    const first = lane.run('foreground', async () => { order.push('intro'); });
    const second = lane.run('foreground', async () => { order.push('reply'); });
    await settle(); expect(order).toEqual(['background-1', 'abort']);
    releaseTransport();
    await expect(background).resolves.toBe('complete'); await Promise.all([first, second]);
    expect(order).toEqual(['background-1', 'abort', 'intro', 'reply', 'background-2']);
    expect(lane.foregroundBusy).toBe(false);
});

test('ordinary background generation keeps its existing cancellation behavior', async () => {
    const lane = new ProviderLane(), operation = jest.fn(aborted);
    const task = lane.run('background', operation); const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError', reason: 'foreground' });
    await settle(); await lane.run('foreground', async () => {}); await rejected;
    expect(operation).toHaveBeenCalledTimes(1);
});

test('explicit active cancellation does not resume, even when its reason is foreground', async () => {
    const lane = new ProviderLane(), cancel = new AbortController(), operation = jest.fn(aborted);
    const task = lane.run('background-resumable', operation, cancel.signal);
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    await settle(); cancel.abort('foreground'); await rejected;
    expect(operation).toHaveBeenCalledTimes(1);
});

test('explicit queued cancellation removes a resumed job without cancelling foreground work', async () => {
    const lane = new ProviderLane(), cancel = new AbortController(), operation = jest.fn(aborted);
    const task = lane.run('background-resumable', operation, cancel.signal);
    const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
    await settle(); let release!: () => void;
    const foreground = lane.run('foreground', () => new Promise<void>(resolve => { release = resolve; }));
    await settle(); cancel.abort(); await rejected;
    expect(lane.foregroundBusy).toBe(true); expect(operation).toHaveBeenCalledTimes(1);
    release(); await foreground; expect(lane.foregroundBusy).toBe(false);
});

test.each([
    new Error('Genuine provider failure'),
    Object.assign(new Error('Provider abort'), { name: 'AbortError', reason: 'foreground' })
])('a provider error is not mistaken for lane preemption: %s', async error => {
    const lane = new ProviderLane(), operation = jest.fn(async () => { throw error; });
    await expect(lane.run('background-resumable', operation)).rejects.toBe(error);
    expect(operation).toHaveBeenCalledTimes(1);
});

test('a completed response is accepted once even if its transport ignored preemption', async () => {
    const lane = new ProviderLane(); let release!: (value: string) => void;
    const operation = jest.fn(() => new Promise<string>(resolve => { release = resolve; }));
    const task = lane.run('background-resumable', operation);
    await settle(); const foreground = lane.run('foreground', async () => {});
    release('completed before cancellation took effect');
    await expect(task).resolves.toBe('completed before cancellation took effect'); await foreground;
    expect(operation).toHaveBeenCalledTimes(1);
});

test('repeated foreground interruptions keep one resumable job rather than duplicating it', async () => {
    const lane = new ProviderLane(); let count = 0;
    const task = lane.run('background-resumable', signal => ++count < 3 ? aborted(signal) : Promise.resolve('done'));
    await settle(); await lane.run('foreground', async () => {}); await settle();
    expect(count).toBe(2);
    await lane.run('foreground', async () => {});
    await expect(task).resolves.toBe('done'); expect(count).toBe(3);
});

test('resumed work retains ordinary background FIFO order', async () => {
    const lane = new ProviderLane(), order: string[] = []; let count = 0;
    const resumed = lane.run('background-resumable', signal => {
        if (++count === 1) return aborted(signal);
        order.push('resumed'); return Promise.resolve('done');
    });
    await settle();
    const ordinary = lane.run('background', async () => { order.push('ordinary'); });
    const foreground = lane.run('foreground', async () => { order.push('foreground'); });
    await Promise.all([resumed, ordinary, foreground]);
    expect(order).toEqual(['foreground', 'ordinary', 'resumed']);
});

test('the real ApiConnection entry resumes the identical prompt, settings and timeout', async () => {
    const prompt = [{ role: 'user', content: 'FROZEN_ONLY_HEARD_WORDS' }], parameters = { temperature: 0.6 };
    let calls = 0;
    const request = jest.fn((...args: any[]) => ++calls === 1 ? aborted(args[4]) : Promise.resolve('remembered'));
    const api = Object.assign(Object.create(ApiConnection.prototype), { work: 'foreground', completeRequest: request });
    const task = api.complete(prompt, false, parameters, undefined, undefined, 300_000, 'background-resumable');
    await settle(); await textProviderLane.run('foreground', async () => {});
    await expect(task).resolves.toBe('remembered');
    expect(request).toHaveBeenCalledTimes(2);
    for (const call of request.mock.calls) {
        expect(call[0]).toBe(prompt); expect(call[2]).toBe(parameters); expect(call[5]).toBe(300_000);
    }
    expect(textProviderLane.foregroundBusy).toBe(false);
});
