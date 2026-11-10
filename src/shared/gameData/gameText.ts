// CK3 display markup is not part of the exported name.
export function removeTooltip(str: string): string {
    if (!str) return "";

    // Remove unwanted ASCII control characters and tooltip/onclick prefixes
    let cleanedStr = str.replace(/[\x15]/g, '')
                      .replace(/\^U[^\n]*/g, '')
                      .replace(/\b(?:ONCLICK|TOOLTIP):[A-Z_]+,[^\s)]+/g, '')
                      .replace(/^\s*([A-Z][;\s]\s*)+/, '')
                      .replace(/(?<![A-Za-z])L\s+/g, '')
                      .replace(/(?<![A-Za-z])[A-Z];\s*/g, '');

    // If a tooltip description marker ' L; ' exists, take the text after it
    const lSemicolonIndex = cleanedStr.indexOf(' L; ');
    if (lSemicolonIndex !== -1) {
        cleanedStr = cleanedStr.substring(lSemicolonIndex + 4);
    }

    // Final cleanup on the resulting string
    cleanedStr = cleanedStr.replace(/!+/g, '')
      .replace(/[\s:!']+$/, '')
      .trim();

    return cleanedStr;
}
