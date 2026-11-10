/** Render literal tooltip text without guessing a character-dependent localization. */
export function staticLocalizationText(expression: string): string | undefined {
    // Both functions have two literal arguments. Glossary displays its first;
    // Concept displays its second. Never evaluate script or choose a conditional.
    const quoted = "(?:'((?:\\\\.|[^'\\\\])*)'|\"((?:\\\\.|[^\"\\\\])*)\")";
    const literal = new RegExp('^(Glossary|Concept)\\(\\s*' + quoted +
        '\\s*,\\s*' + quoted + '\\s*\\)(?:\\|[A-Za-z]+)?$').exec(expression.trim());
    if (!literal) return undefined;
    const text = literal[1] === 'Glossary' ? literal[2] ?? literal[3] : literal[4] ?? literal[5];
    // Only ordinary string escapes are interpreted; unknown escapes stay literal.
    return text.replace(/\\(['"\\])/gu, '$1');
}
