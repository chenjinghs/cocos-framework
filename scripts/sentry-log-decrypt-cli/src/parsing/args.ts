import { getDownloadsDir, resolvePath } from "../utils/path";
import { parseOptionalPositiveInteger, parseRequiredInteger, parseRequiredPositiveInteger } from "../utils/number";
import { inferSentryEnv, inferSentryEnvFromUrl, parseSentryEnv } from "../utils/environment";
import { SingleDecryptOptions, UidDownloadOptions, UrlDownloadOptions } from "../types";
import { normalizeOptionalTime, parseSentryUrlTarget, readOptionValue, splitOption } from "./parsers";

export function parseSingleDecryptArgs(args: string[]): SingleDecryptOptions {
    let inputPath: string | undefined;
    let outputPath: string | undefined;
    let appVersion: number | undefined;
    let environment: string | undefined;
    let platform = "Android";

    for (let index = 0; index < args.length; index += 1) {
        const [name, inlineValue] = splitOption(args[index]);
        switch (name) {
            case "--input":
            case "-i":
                inputPath = readOptionValue(args, index, name, inlineValue);
                if (inlineValue === undefined) index += 1;
                break;
            case "--output":
            case "-o":
                outputPath = readOptionValue(args, index, name, inlineValue);
                if (inlineValue === undefined) index += 1;
                break;
            case "--app-version":
            case "-a":
                appVersion = parseRequiredInteger(readOptionValue(args, index, name, inlineValue), "--app-version");
                if (inlineValue === undefined) index += 1;
                break;
            case "--environment":
            case "-e":
                environment = readOptionValue(args, index, name, inlineValue);
                if (inlineValue === undefined) index += 1;
                break;
            case "--platform":
            case "-p":
                platform = readOptionValue(args, index, name, inlineValue);
                if (inlineValue === undefined) index += 1;
                break;
            default:
                throw new Error(`Unknown argument: ${args[index]}`);
        }
    }

    if (!inputPath) throw new Error("Missing required argument: --input");
    if (!outputPath) throw new Error("Missing required argument: --output");
    if (appVersion === undefined) throw new Error("Missing required argument: --app-version");
    if (!environment) throw new Error("Missing required argument: --environment");

    return {
        inputPath: resolvePath(inputPath),
        outputPath: resolvePath(outputPath),
        appVersion,
        environment,
        platform,
    };
}

export function parseUidDownloadArgs(args: string[]): UidDownloadOptions {
    const raw: Partial<UidDownloadOptions> = {
        includeBak: true,
    };

    for (let index = 0; index < args.length; index += 1) {
        const [name, inlineValue] = splitOption(args[index]);
        switch (name) {
            case "--uid":
            case "-u":
                raw.uid = readOptionValue(args, index, name, inlineValue);
                if (inlineValue === undefined) index += 1;
                break;
            case "--env":
                raw.env = parseSentryEnv(readOptionValue(args, index, name, inlineValue));
                if (inlineValue === undefined) index += 1;
                break;
            case "--start":
                raw.start = readOptionValue(args, index, name, inlineValue);
                if (inlineValue === undefined) index += 1;
                break;
            case "--end":
                raw.end = readOptionValue(args, index, name, inlineValue);
                if (inlineValue === undefined) index += 1;
                break;
            case "--output":
            case "-o":
                raw.outputDir = readOptionValue(args, index, name, inlineValue);
                if (inlineValue === undefined) index += 1;
                break;
            case "--limit":
                raw.limit = parseRequiredPositiveInteger(readOptionValue(args, index, name, inlineValue), "--limit");
                if (inlineValue === undefined) index += 1;
                break;
            case "--no-bak":
                raw.includeBak = false;
                break;
            default:
                throw new Error(`Unknown argument for uid command: ${args[index]}`);
        }
    }

    if (!raw.uid) throw new Error("Missing required argument: --uid");
    return {
        uid: raw.uid,
        env: raw.env ?? inferSentryEnv(process.cwd()),
        start: normalizeOptionalTime(raw.start, false),
        end: normalizeOptionalTime(raw.end, true),
        outputDir: resolvePath(raw.outputDir ?? getDownloadsDir()),
        limit: raw.limit,
        includeBak: raw.includeBak ?? true,
    };
}

export function parseUrlDownloadArgs(args: string[]): UrlDownloadOptions {
    const raw: Partial<UrlDownloadOptions> = {
        includeBak: true,
    };

    for (let index = 0; index < args.length; index += 1) {
        const [name, inlineValue] = splitOption(args[index]);
        switch (name) {
            case "--url":
                raw.url = readOptionValue(args, index, name, inlineValue);
                if (inlineValue === undefined) index += 1;
                break;
            case "--env":
                raw.env = parseSentryEnv(readOptionValue(args, index, name, inlineValue));
                if (inlineValue === undefined) index += 1;
                break;
            case "--output":
            case "-o":
                raw.outputDir = readOptionValue(args, index, name, inlineValue);
                if (inlineValue === undefined) index += 1;
                break;
            case "--no-bak":
                raw.includeBak = false;
                break;
            default:
                throw new Error(`Unknown argument for url command: ${args[index]}`);
        }
    }

    if (!raw.url) throw new Error("Missing required argument: --url");
    return {
        url: raw.url,
        target: parseSentryUrlTarget(raw.url),
        env: raw.env ?? inferSentryEnvFromUrl(raw.url, inferSentryEnv(process.cwd())),
        outputDir: resolvePath(raw.outputDir ?? getDownloadsDir()),
        includeBak: raw.includeBak ?? true,
    };
}
