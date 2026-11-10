/** Physical mouth resonance only; the learned Culture and individual identity remain. */
export const TUSKARR_DIRECTION = "Use rotund, full-cheeked walrus resonance and rounded, slightly mouth-filled articulation around large tusks. Keep every word intelligible and retain the reference speaker's sex, pitch range and learned accent.";
export function tuskarrDirection(voice?:{anatomyId?:string;body?:string}):string|undefined {
    return (voice?.anatomyId ? voice.anatomyId==='029' : voice?.body==='creature_tuskarr')
        ? TUSKARR_DIRECTION : undefined;
}
