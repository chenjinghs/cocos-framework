export function clampIndex(index: number, choices: readonly string[]): number {
    if (choices.length === 0) {
        throw new Error("No choices available.");
    }

    if (index < 0 || index >= choices.length) {
        return 0;
    }

    return index;
}
