export function trimTrailingSlash(value: string): string {
    return value.replace(/\/+$/, "");
}

export function getNextPageUrl(linkHeader: string | null): string {
    if (!linkHeader) {
        return "";
    }

    for (const part of linkHeader.split(",")) {
        if (!part.includes('rel="next"') || !part.includes('results="true"')) {
            continue;
        }

        const match = part.match(/<([^>]+)>/);
        if (match?.[1]) {
            return match[1];
        }
    }

    return "";
}
