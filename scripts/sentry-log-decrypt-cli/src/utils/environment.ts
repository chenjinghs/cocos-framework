import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { FALLBACK_ENVIRONMENT_CHOICES, VALID_SENTRY_ENVS } from "../constants";
import { SentryEnv } from "../types";

export function normalizeEnvironment(environment: string): string {
    const normalized = environment.trim();
    if (!normalized) {
        throw new Error("The --environment value cannot be empty.");
    }

    return normalized.toLowerCase().replaceAll("_", "-");
}

export function normalizePlatform(platform: string): string {
    const normalized = platform.trim();
    if (!normalized) {
        throw new Error("The --platform value cannot be empty.");
    }

    switch (normalized.toLowerCase()) {
        case "android":
            return "Android";
        case "ios":
        case "iphone":
        case "iphoneplayer":
            return "IPhonePlayer";
        case "windows":
        case "windowsplayer":
            return "WindowsPlayer";
        case "linux":
        case "linuxplayer":
            return "LinuxPlayer";
        case "macos":
        case "osx":
        case "osxplayer":
            return "OSXPlayer";
        default:
            return normalized;
    }
}

export function parseSentryEnv(value: string): SentryEnv {
    if ((VALID_SENTRY_ENVS as readonly string[]).includes(value)) {
        return value as SentryEnv;
    }

    throw new Error(`Invalid Sentry env: ${value}. Valid values: ${VALID_SENTRY_ENVS.join(", ")}`);
}

export function inferSentryEnv(basePath: string): SentryEnv {
    const normalized = basePath.toLowerCase().replaceAll("\\", "/");
    if (normalized.includes("hmt")) return "hmt";
    if (normalized.includes("ea")) return "ea";
    if (normalized.includes("ru")) return "ru";
    return "cn";
}

export function inferSentryEnvFromUrl(value: string, fallback: SentryEnv): SentryEnv {
    try {
        const url = new URL(value.trim().replace(/^"|"$/g, ""));
        if (url.hostname.endsWith("seayoo.com")) {
            return "cn";
        }

        if (url.hostname.endsWith("seayoo.io")) {
            return "ea";
        }
    } catch {
        return fallback;
    }

    return fallback;
}

export function readEnvironmentChoices(): string[] {
    const configPath = findConfigurationGroovy(process.cwd()) ?? findConfigurationGroovy(__dirname);
    if (!configPath) {
        return [...FALLBACK_ENVIRONMENT_CHOICES];
    }

    try {
        const content = readFileSync(configPath, "utf8");
        const block = extractGroovyMapBlock(content, "def configurationList = [");
        const choices = [...block.matchAll(/^\s*'([^']+)'\s*:\s*\[/gm)].map((match) => match[1]);
        return choices.length > 0 ? choices : [...FALLBACK_ENVIRONMENT_CHOICES];
    } catch {
        return [...FALLBACK_ENVIRONMENT_CHOICES];
    }
}

function findConfigurationGroovy(startPath: string): string | undefined {
    let current = resolve(startPath);
    while (true) {
        const configPath = join(current, "ci", "library", "vars", "getConfiguration.groovy");
        if (existsSync(configPath)) {
            return configPath;
        }

        const parent = dirname(current);
        if (parent === current) {
            return undefined;
        }

        current = parent;
    }
}

function extractGroovyMapBlock(content: string, marker: string): string {
    const markerIndex = content.indexOf(marker);
    if (markerIndex < 0) {
        throw new Error(`Cannot find marker: ${marker}`);
    }

    const startIndex = content.indexOf("[", markerIndex);
    if (startIndex < 0) {
        throw new Error(`Cannot find map start after marker: ${marker}`);
    }

    let depth = 0;
    let quote: "'" | "\"" | undefined;
    for (let index = startIndex; index < content.length; index += 1) {
        const char = content[index];
        const previousChar = content[index - 1];
        if (quote) {
            if (char === quote && previousChar !== "\\") {
                quote = undefined;
            }
            continue;
        }

        if (char === "'" || char === "\"") {
            quote = char;
            continue;
        }

        if (char === "[") {
            depth += 1;
            continue;
        }

        if (char === "]") {
            depth -= 1;
            if (depth === 0) {
                return content.slice(startIndex, index + 1);
            }
        }
    }

    throw new Error(`Cannot find map end after marker: ${marker}`);
}
