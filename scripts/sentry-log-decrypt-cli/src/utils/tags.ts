export function tagsToMap(tags: Array<{ key?: string; value?: string }>): Map<string, string> {
    const result = new Map<string, string>();
    for (const tag of tags) {
        if (tag.key && tag.value !== undefined) {
            result.set(tag.key, tag.value);
        }
    }

    return result;
}

export function readRequiredTag(tags: Map<string, string>, key: string, eventId: string): string {
    const value = tags.get(key);
    if (!value) {
        throw new Error(`Event ${eventId} is missing tag: ${key}`);
    }

    return value;
}
