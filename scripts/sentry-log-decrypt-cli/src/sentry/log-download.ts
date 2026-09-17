import { writeFileSync } from "node:fs";
import { CLI_NAME } from "../constants";
import { decryptLog } from "../crypto/decrypt-log";
import { DownloadResult, SentryConfig, SentryEvent } from "../types";
import { buildLogFileName, makeUniquePath } from "../utils/path";
import { readRequiredTag, tagsToMap } from "../utils/tags";
import { buildSentryEventUrl, downloadAttachment, getAttachments, getEventDetail, isLogAttachment } from "./api";

export async function processEventLogs(
    config: SentryConfig,
    event: SentryEvent,
    options: { uid?: string; includeBak: boolean },
    outputRoot: string,
): Promise<DownloadResult[]> {
    const detail = await getEventDetail(config, event.id);
    const tags = tagsToMap(detail.tags ?? []);
    const eventTime = detail.dateCreated ?? event.timestamp ?? new Date().toISOString();
    const sentryUrl = buildSentryEventUrl(config, detail);
    const uid = options.uid ?? tags.get("uid") ?? event.uid ?? "unknown";
    const attachments = await getAttachments(config, event.id);
    const logAttachments = attachments.filter((attachment) => isLogAttachment(attachment.name, options.includeBak));

    if (logAttachments.length === 0) {
        return [
            {
                uid,
                eventId: event.id,
                eventTime,
                sentryUrl,
                attachment: "",
                status: "skipped",
                error: "No log.enc attachment.",
            },
        ];
    }

    const results: DownloadResult[] = [];
    for (const attachment of logAttachments) {
        try {
            const appVersion = readRequiredTag(tags, "app_res_version", event.id);
            const environment = readRequiredTag(tags, "environment", event.id);
            const platform = readRequiredTag(tags, "os.name", event.id);
            const encrypted = await downloadAttachment(config, event.id, attachment.id);
            const decrypted = decryptLog(encrypted, Number.parseInt(appVersion, 10), environment, platform);
            const outputPath = makeUniquePath(outputRoot, buildLogFileName(uid, event.id, eventTime, attachment.name));
            writeFileSync(outputPath, decrypted, "utf8");

            console.log(`[${CLI_NAME}] ${event.id} ${attachment.name} -> ${outputPath}`);
            results.push({
                uid,
                eventId: event.id,
                eventTime,
                sentryUrl,
                attachment: attachment.name,
                outputPath,
                status: "downloaded",
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn(`[${CLI_NAME}] ${event.id} ${attachment.name} failed: ${message}`);
            results.push({
                uid,
                eventId: event.id,
                eventTime,
                sentryUrl,
                attachment: attachment.name,
                status: "failed",
                error: message,
            });
        }
    }

    return results;
}
