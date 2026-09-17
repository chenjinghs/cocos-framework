export function parseRequiredInteger(value: string, optionName: string): number {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
        throw new Error(`${optionName} must be an integer.`);
    }

    return parsed;
}

export function parseRequiredPositiveInteger(value: string, optionName: string): number {
    const parsed = parseRequiredInteger(value, optionName);
    if (parsed <= 0) {
        throw new Error(`${optionName} must be a positive integer.`);
    }

    return parsed;
}

export function parseOptionalPositiveInteger(value: string | undefined, label: string): number | undefined {
    if (!value) {
        return undefined;
    }

    return parseRequiredPositiveInteger(value, label);
}
