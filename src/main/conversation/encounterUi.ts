import type { ChatWindow } from '../windows/ChatWindow';

/** Keep Electron method receivers intact while preventing a retired encounter from sending into the shared chat. */
export function bindEncounterChatWindow(host: ChatWindow, active: () => boolean): ChatWindow {
    const methods = new WeakMap<object, Map<PropertyKey, unknown>>();
    const bound = (target: any, key: PropertyKey) => {
        const value = Reflect.get(target, key, target);
        if (typeof value !== 'function') return value;
        let cached = methods.get(target);
        if (!cached) { cached = new Map(); methods.set(target, cached); }
        if (!cached.has(key)) cached.set(key, value.bind(target));
        return cached.get(key);
    };
    const webContents = new Proxy(host.window.webContents, { get(target, key) {
        if (key === 'send') return (...args: any[]) => {
            if (active() && !target.isDestroyed()) (target.send as (...values: any[]) => void)(...args);
        };
        return bound(target, key);
    } });
    const window = new Proxy(host.window, { get(target, key) {
        if (key === 'webContents') return webContents;
        return bound(target, key);
    } });
    return new Proxy(host, { get(target, key) {
        if (key === 'window') return window;
        if (key === 'show' || key === 'hide') return (...args: any[]) => {
            if (active()) return (bound(target, key) as (...values: any[]) => unknown)(...args);
        };
        return bound(target, key);
    } });
}
