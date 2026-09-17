import { stripWrappingQuotes } from "../utils/path";
import { SentryUrlTarget } from "../types";

export function splitOption(argument: string): [string, string | undefined] {
    const separatorIndex = argument.indexOf("=");
    if (separatorIndex < 0) {
        return [argument, undefined];
    }

    return [argument.slice(0, separatorIndex), argument.slice(separatorIndex + 1)];
}

export function readOptionValue(args: string[], index: number, optionName: string, inlineValue?: string): string {
    if (inlineValue !== undefined) {
        return inlineValue;
    }

    const value = args[index + 1];
    if (value === undefined) {
        throw new Error(`Missing value for ${optionName}`);
    }

    return value;
}

export function normalizeOptionalTime(value: string | undefined, isEnd: boolean): string | undefined {
    if (!value?.trim()) {
        return undefined;
    }

    const trimmed = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
        return `${trimmed}T${isEnd ? "23:59:59" : "00:00:00"}Z`;
    }

    const normalized = trimmed.includes(" ") ? trimmed.replace(" ", "T") : trimmed;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) {
        throw new Error(`Invalid time: ${value}`);
    }

    return normalized;
}

export function parseSentryUrlTarget(value: string): SentryUrlTarget {
    const trimmed = stripWrappingQuotes(value);
    if (/^[a-f0-9]{32}$/i.test(trimmed)) {
        return { kind: "event", eventId: trimmed };
    }

    let url: URL;
    try {
        url = new URL(trimmed);
    } catch {
        throw new Error(`Invalid Sentry URL: ${value}`);
    }

    const eventMatch = url.pathname.match(/\/events\/([a-f0-9]{32})\/?$/i);
    if (eventMatch?.[1]) {
        return { kind: "event", eventId: eventMatch[1] };
    }

    const queryMatch = decodeURIComponent(url.search).match(/event\.id:([a-f0-9]{32})/i);
    if (queryMatch?.[1]) {
        return { kind: "event", eventId: queryMatch[1] };
    }

    const issueMatch = url.pathname.match(/\/issues\/(\d+)\/?$/i);
    if (issueMatch?.[1]) {
        return { kind: "issue", issueId: issueMatch[1] };
    }

    throw new Error(`Cannot parse event or issue id from Sentry URL: ${value}`);
}
