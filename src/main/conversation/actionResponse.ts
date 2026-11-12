/** Malformed classifier output is never an instruction to execute an action. */
export function parseActionResponse(response: string): { rationale: string; actions: string } | null {
    const rationale = response.match(/<rationale>([\s\S]*?)<\/rationale>/);
    const actions = response.match(/<actions>([\s\S]*?)<\/actions>/);
    if (!rationale || !actions || /<\/?(?:rationale|actions)>/.test(rationale[1] + actions[1]) ||
        (response.match(/<rationale>/g) ?? []).length !== 1 || (response.match(/<actions>/g) ?? []).length !== 1) return null;
    return { rationale: rationale[1], actions: actions[1] };
}
