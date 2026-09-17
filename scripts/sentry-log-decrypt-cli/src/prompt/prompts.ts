import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { PLATFORM_CHOICES } from "../constants";
import { SingleDecryptOptions, UidDownloadOptions, UrlDownloadOptions, SentryEnv } from "../types";
import { buildDefaultOutputPath, getDownloadsDir, resolvePath, stripWrappingQuotes } from "../utils/path";
import { inferSentryEnvFromUrl, normalizeEnvironment, normalizePlatform, readEnvironmentChoices } from "../utils/environment";
import { parseOptionalPositiveInteger } from "../utils/number";
import { normalizeOptionalTime, parseSentryUrlTarget } from "../parsing/parsers";
import { askRequired, askInputPath, askInteger } from "./questions";
import { selectValue } from "./select";

export async function promptSingleDecryptOptions(): Promise<SingleDecryptOptions> {
    const rl = createInterface({ input, output });
    let inputPath = "";
    let outputPath = "";
    let appVersion = 0;

    try {
        inputPath = resolvePath(await askInputPath(rl));
        const defaultOutput = buildDefaultOutputPath(inputPath);
        const rawOutputPath = stripWrappingQuotes((await rl.question(`output path (default ${defaultOutput}): `)).trim());
        outputPath = rawOutputPath ? resolvePath(rawOutputPath) : defaultOutput;
        appVersion = await askInteger(rl, "app_res_version");
    } finally {
        rl.close();
    }

    const environment = await askEnvironment();
    const platform = await askPlatform();
    return {
        inputPath,
        outputPath,
        appVersion,
        environment,
        platform,
    };
}

export async function promptUidDownloadOptions(): Promise<UidDownloadOptions> {
    const rl = createInterface({ input, output });
    try {
        const uid = await askRequired(rl, "uid");
        const start = normalizeOptionalTime((await rl.question("start time (optional, e.g. 2026-07-06T00:00:00Z): ")).trim() || undefined, false);
        const end = normalizeOptionalTime((await rl.question("end time (optional, e.g. 2026-07-08T00:00:00Z): ")).trim() || undefined, true);
        const outputDir = resolvePath((await rl.question(`output parent dir (default ${getDownloadsDir()}): `)).trim() || getDownloadsDir());
        const limit = parseOptionalPositiveInteger((await rl.question("max events (optional): ")).trim() || undefined, "max events");
        const env = await askSentryEnv();

        return {
            uid,
            env,
            start,
            end,
            outputDir,
            limit,
            includeBak: true,
        };
    } finally {
        rl.close();
    }
}

export async function promptUrlDownloadOptions(): Promise<UrlDownloadOptions> {
    const rl = createInterface({ input, output });
    try {
        const url = await askRequired(rl, "Sentry URL");
        const outputDir = resolvePath((await rl.question(`output parent dir (default ${getDownloadsDir()}): `)).trim() || getDownloadsDir());
        const env = await askSentryEnv(inferSentryEnvFromUrl(url, "cn"));
        return {
            url,
            target: parseSentryUrlTarget(url),
            env,
            outputDir,
            includeBak: true,
        };
    } finally {
        rl.close();
    }
}

async function askPlatform(): Promise<string> {
    return selectValue("platform", [...PLATFORM_CHOICES], 0, normalizePlatform);
}

async function askEnvironment(): Promise<string> {
    return selectValue("environment", readEnvironmentChoices(), 0, normalizeEnvironment);
}

async function askSentryEnv(defaultEnv: SentryEnv = "cn"): Promise<SentryEnv> {
    const choices: SentryEnv[] = ["cn", "hmt", "ea", "ru"];
    const defaultIndex = Math.max(0, choices.indexOf(defaultEnv));
    return (await selectValue("sentry env", choices, defaultIndex, (value) => value)) as SentryEnv;
}
