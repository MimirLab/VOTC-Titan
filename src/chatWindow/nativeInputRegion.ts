import { ipcRenderer } from 'electron';

/** Keep the transparent Linux overlay outside visible chat panels click-through. */
export function installNativeInputRegions(): void {
    if (process.platform !== 'linux') return;
    let scheduled = false;
    let last = '';
    let dragging = false;
    const publish = () => {
        scheduled = false;
        const nodes = document.querySelectorAll<HTMLElement>(
            'body > :not(script), .suggestions-container, .custom-select-options, .search-dropdown, #slash-command-container');
        const rects = dragging ? [{ x: 0, y: 0, width: innerWidth, height: innerHeight }] :
            [...nodes].flatMap(node => {
                const style = getComputedStyle(node);
                const r = node.getBoundingClientRect();
                if (!node.getClientRects().length || style.visibility === 'hidden' || style.opacity === '0') return [];
                let left = Math.max(0, r.left), top = Math.max(0, r.top);
                let right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
                for (let p = node.parentElement; p; p = p.parentElement) {
                    const s = getComputedStyle(p), b = p.getBoundingClientRect();
                    if (s.overflowX !== 'visible') { left = Math.max(left, b.left); right = Math.min(right, b.right); }
                    if (s.overflowY !== 'visible') { top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom); }
                }
                return right > left && bottom > top ? [{ x: Math.floor(left), y: Math.floor(top),
                    width: Math.ceil(right) - Math.floor(left), height: Math.ceil(bottom) - Math.floor(top) }] : [];
            });
        const signature = JSON.stringify(rects);
        if (signature !== last) { last = signature; ipcRenderer.send('chat-input-regions', rects); }
    };
    const schedule = () => {
        if (!scheduled) { scheduled = true; requestAnimationFrame(publish); }
    };
    new MutationObserver(schedule).observe(document.body, { attributes: true, childList: true, subtree: true });
    const resize = new ResizeObserver(schedule);
    resize.observe(document.body);
    const panel = document.querySelector('.chat-box');
    if (panel) resize.observe(panel);
    window.addEventListener('resize', schedule);
    document.addEventListener('mouseover', schedule);
    document.addEventListener('mouseout', schedule);
    // Native drag/resize gestures keep mouse capture until release.
    document.addEventListener('mousedown', () => { dragging = true; schedule(); });
    window.addEventListener('mouseup', () => { dragging = false; schedule(); });
    window.addEventListener('blur', () => { dragging = false; schedule(); });
    schedule();
}
