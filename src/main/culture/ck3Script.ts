/** Small lossless Clausewitz reader: comments, quoted strings, duplicate keys, lists and operators. */
export interface ScriptEntry { key?: string; operator?: string; value: string | ScriptEntry[] }

export function parseCk3Script(source: string): ScriptEntry[] {
    const tokens: string[] = [];
    const pattern = /\s+|\uFEFF|#[^\r\n]*|"(?:\\.|[^"\\])*"|[{}]|[<>!?]?=|[<>]|[^\s{}=<>!?"#]+/gy;
    let position = 0;
    while (position < source.length) {
        pattern.lastIndex = position;
        const match = pattern.exec(source);
        if (!match) throw new Error(`Unsupported CK3 syntax at byte ${position}`);
        position = pattern.lastIndex;
        if (/^\s|^\uFEFF|^#/.test(match[0])) continue;
        tokens.push(match[0]);
    }
    let index = 0;
    const scalar = (token: string) => token.startsWith('"') ? token.slice(1, -1).replace(/\\(["\\])/g, '$1') : token;
    const block = (nested: boolean): ScriptEntry[] => {
        const entries: ScriptEntry[] = [];
        while (index < tokens.length && tokens[index] !== '}') {
            let token = tokens[index++];
            if (token === '{') { entries.push({ value: block(true) }); continue; }
            const operator = tokens[index];
            if (/^(?:[<>!?]?=|[<>])$/.test(operator ?? '')) {
                index++;
                const next = tokens[index++];
                if (!next || next === '}') throw new Error('Missing CK3 value');
                entries.push({ key: scalar(token), operator, value: next === '{' ? block(true) : scalar(next) });
            } else {
                entries.push({ value: scalar(token) });
            }
        }
        if (nested) {
            if (tokens[index++] !== '}') throw new Error('Unclosed CK3 block');
        } else if (index !== tokens.length) throw new Error('Unexpected CK3 brace');
        return entries;
    };
    return block(false);
}

export function scriptString(entries: ScriptEntry[], key: string): string | undefined {
    const value = entries.find(e => e.key === key)?.value;
    return typeof value === 'string' ? value : undefined;
}

export function scriptStrings(entries: ScriptEntry[], key: string): string[] {
    return entries.filter(e => e.key === key && typeof e.value === 'string').map(e => e.value as string);
}
