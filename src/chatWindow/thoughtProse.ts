import { controlledProseView, parseControlledProse } from '../shared/language/controlledProse';

export interface ReadingPart {
    readonly text: string;
    readonly thought: boolean;
}

/** Decorate only boundaries in this recipient's already-visible projection. */
export function thoughtProseParts(content: string, editableContent?: string): readonly ReadingPart[] {
    const unchanged = [{ text: content, thought: false }];
    if (editableContent === undefined) return unchanged;
    try {
        const view = controlledProseView(parseControlledProse(editableContent), true);
        // Never substitute editor/source text for the delivered reading view, or guess at
        // boundaries in legacy, partially streamed or otherwise mismatched messages.
        if (view.content !== content) return unchanged;
        const thoughts = view.proseSpans.filter(span => span.kind === 'private');
        if (!thoughts.length) return unchanged;
        const parts: ReadingPart[] = [];
        let cursor = 0;
        for (const span of thoughts) {
            if (span.start > cursor) parts.push({ text: content.slice(cursor, span.start), thought: false });
            parts.push({ text: content.slice(span.start, span.end), thought: true });
            cursor = span.end;
        }
        if (cursor < content.length) parts.push({ text: content.slice(cursor), thought: false });
        return parts;
    } catch {
        return unchanged;
    }
}
