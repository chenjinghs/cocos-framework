import { writeFileSync } from "node:fs";
import { EOL } from "node:os";
import { join } from "node:path";
import { CLI_NAME } from "../constants";
import { createOutputRoot } from "../utils/path";
import { requireRepoRoot } from "../utils/repo";
import { DownloadResult, SentryConfig, UidDownloadOptions, UrlDownloadOptions } from "../types";
import { findEventsByUid, getIssueLatestEvent, readSentryConfig } from "../sentry/api";
import { processEventLogs } from "../sentry/log-download";

export async function runUidDownload(options: UidDownloadOptions): Promise<number> {
    const repoRoot = requireRepoRoot();
    const config = readSentryConfig(repoRoot, options.env);
    const outputRoot = createOutputRoot(options.outputDir, options.uid);
    console.log(`[${CLI_NAME}] command=uid, env=${options.env}, uid=${options.uid}`);
    console.log(`[${CLI_NAME}] output=${outputRoot}`);

    const events = await findEventsByUid(config, options);
    console.log(`[${CLI_NAME}] found ${events.length} event(s).`);

    const results: DownloadResult[] = [];
    for (const event of events) {
        results.push(...(await processEventLogs(config, event, options, outputRoot)));
    }

    writeDownloadSummary(outputRoot, { command: "uid", ...options }, events.length, results);
    return results.some((item) => item.status === "failed") ? 1 : 0;
}

export async function runUrlDownload(options: UrlDownloadOptions): Promise<number> {
    const repoRoot = requireRepoRoot();
    const config = readSentryConfig(repoRoot, options.env);
    const eventId = await resolveUrlTargetEventId(config, options);
    const outputRoot = createOutputRoot(options.outputDir, eventId);
    console.log(`[${CLI_NAME}] command=url, env=${options.env}, event=${eventId}`);
    console.log(`[${CLI_NAME}] output=${outputRoot}`);

    const results = await processEventLogs(config, { id: eventId }, options, outputRoot);
    writeDownloadSummary(
        outputRoot,
        { command: "url", url: options.url, target: options.target, resolvedEventId: eventId, env: options.env, outputDir: options.outputDir, includeBak: options.includeBak },
        1,
        results,
    );
    return results.some((item) => item.status === "failed") ? 1 : 0;
}

async function resolveUrlTargetEventId(config: SentryConfig, options: UrlDownloadOptions): Promise<string> {
    if (options.target.kind === "event") {
        return options.target.eventId;
    }

    const detail = await getIssueLatestEvent(config, options.target.issueId);
    console.log(`[${CLI_NAME}] issue=${options.target.issueId}, latestEvent=${detail.id}`);
    return detail.id;
}

function writeDownloadSummary(outputRoot: string, options: object, events: number, results: DownloadResult[]): void {
    const summaryPath = join(outputRoot, "summary.json");
    writeFileSync(summaryPath, `${JSON.stringify({ options, events, results }, null, 4)}${EOL}`, "utf8");

    const downloaded = results.filter((item) => item.status === "downloaded").length;
    const failed = results.filter((item) => item.status === "failed").length;
    const skipped = results.filter((item) => item.status === "skipped").length;
    console.log(`[${CLI_NAME}] downloaded=${downloaded}, skipped=${skipped}, failed=${failed}`);
    console.log(`[${CLI_NAME}] summary=${summaryPath}`);
}
