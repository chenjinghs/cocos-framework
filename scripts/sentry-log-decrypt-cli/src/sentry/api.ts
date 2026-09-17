import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LOG_ATTACHMENT_NAMES } from "../constants";
import { SentryAttachment, SentryConfig, SentryEnv, SentryEvent, SentryEventDetail, SentryProject, UidDownloadOptions } from "../types";
import { getNextPageUrl, trimTrailingSlash } from "../utils/http";

export async function findEventsByUid(config: SentryConfig, options: UidDownloadOptions): Promise<SentryEvent[]> {
    const project = await getProject(config);
    const params = new URLSearchParams();
    params.append("project", project.id);
    params.append("query", `uid:${options.uid}`);
    params.append("field", "id");
    params.append("field", "timestamp");
    params.append("field", "title");
    params.append("field", "uid");
    params.append("per_page", "100");
    if (options.start) params.append("start", options.start);
    if (options.end) params.append("end", options.end);

    const events: SentryEvent[] = [];
    let url = `${trimTrailingSlash(config.baseUrl)}/api/0/organizations/${config.org}/events/?${params.toString()}`;
    while (url) {
        const response = await sentryFetch(config, url);
        const body = (await response.json()) as { data?: SentryEvent[] };
        for (const event of body.data ?? []) {
            events.push(event);
            if (options.limit !== undefined && events.length >= options.limit) {
                return events;
            }
        }

        url = getNextPageUrl(response.headers.get("link"));
    }

    return events;
}

export async function getEventDetail(config: SentryConfig, eventId: string): Promise<SentryEventDetail> {
    return await getJson<SentryEventDetail>(config, `${trimTrailingSlash(config.baseUrl)}/api/0/projects/${config.org}/${config.project}/events/${eventId}/`);
}

export async function getIssueLatestEvent(config: SentryConfig, issueId: string): Promise<SentryEventDetail> {
    return await getJson<SentryEventDetail>(config, `${trimTrailingSlash(config.baseUrl)}/api/0/issues/${issueId}/events/latest/`);
}

export async function getAttachments(config: SentryConfig, eventId: string): Promise<SentryAttachment[]> {
    return await getJson<SentryAttachment[]>(config, `${trimTrailingSlash(config.baseUrl)}/api/0/projects/${config.org}/${config.project}/events/${eventId}/attachments/`);
}

export async function downloadAttachment(config: SentryConfig, eventId: string, attachmentId: string): Promise<Buffer> {
    const response = await sentryFetch(config, `${trimTrailingSlash(config.baseUrl)}/api/0/projects/${config.org}/${config.project}/events/${eventId}/attachments/${attachmentId}/?download=1`);
    return Buffer.from(await response.arrayBuffer());
}

export function buildSentryEventUrl(config: SentryConfig, detail: SentryEventDetail): string {
    const baseUrl = trimTrailingSlash(config.baseUrl);
    const groupId = detail.groupID ?? detail.groupId;
    if (groupId) {
        return `${baseUrl}/organizations/${config.org}/issues/${groupId}/events/${detail.id}/`;
    }

    const query = encodeURIComponent(`event.id:${detail.id}`);
    return `${baseUrl}/organizations/${config.org}/issues/?query=${query}`;
}

export function readSentryConfig(repoRoot: string, env: SentryEnv): SentryConfig {
    const envPath = join(repoRoot, ".agents", `.sentry.${env}.env`);
    if (!existsSync(envPath)) {
        throw new Error(`Sentry env file not found: ${envPath}`);
    }

    const values = new Map<string, string>();
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const match = line.match(/^([^=#]+)=(.*)$/);
        if (match) {
            values.set(match[1].trim(), match[2].trim().replace(/^"|"$/g, ""));
        }
    }

    return {
        baseUrl: readRequiredEnv(values, "SENTRY_BASE_URL", envPath),
        org: readRequiredEnv(values, "SENTRY_ORG", envPath),
        project: readRequiredEnv(values, "SENTRY_PROJECT", envPath),
        authToken: readRequiredEnv(values, "SENTRY_AUTH_TOKEN", envPath),
    };
}

export function isLogAttachment(name: string, includeBak: boolean): boolean {
    const targetNames = includeBak ? LOG_ATTACHMENT_NAMES : ["log.enc"];
    return (targetNames as readonly string[]).includes(name);
}

async function getProject(config: SentryConfig): Promise<SentryProject> {
    return await getJson<SentryProject>(config, `${trimTrailingSlash(config.baseUrl)}/api/0/projects/${config.org}/${config.project}/`);
}

async function getJson<T>(config: SentryConfig, url: string): Promise<T> {
    const response = await sentryFetch(config, url);
    return (await response.json()) as T;
}

async function sentryFetch(config: SentryConfig, url: string, retries = 3): Promise<Response> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= retries; attempt += 1) {
        try {
            const response = await fetch(url, {
                headers: {
                    Authorization: `Bearer ${config.authToken}`,
                },
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(`Sentry API ${response.status} ${response.statusText}: ${text}`);
            }

            return response;
        } catch (error) {
            lastError = error;
            if (attempt < retries) {
                await sleep(500 * attempt);
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function readRequiredEnv(values: Map<string, string>, key: string, envPath: string): string {
    const value = values.get(key);
    if (!value) {
        throw new Error(`Missing ${key} in ${envPath}`);
    }

    return value;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
