import axios from "axios";
import clipboard from "clipboardy";
import assert from "node:assert";
import readline from "node:readline/promises";

import { EPlatform, ERuntime, ISentryIssueEventData, ISentryIssueEventDetailResponse, ISentryIssueEventsResponse, SENTRY_API_GET_ISSUE_EVENT_DETAIL, SENTRY_API_GET_ISSUE_EVENTS, SENTRY_TOKEN } from "./Define";

export function stringFormat(str: string, values: Record<string, string>) {
    return str.replace(/\${(\w+)}/g, (match, key) => values[key] || match);
}

async function readUrlFromClipboard() {
    try {
        return await clipboard.read();
    } catch {
        return "";
    }
}

async function readUrlFromInput() {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const url = await rl.question("请输入sentry issue url: ");
    rl.close();
    return url;
}

function parseSentryUrl(url: string) {
    const match = url.match(/\/issues\/(\d+)(?:\/events\/(\w+))?/);
    if (match === null) return undefined;
    const [_, issueId, eventId] = match;
    return { issueId, eventId };
}

async function callSentryApi<T>(url: string): Promise<T> {
    assert(SENTRY_TOKEN, "SENTRY_AUTH_TOKEN 未配置,请设置环境变量 SENTRY_AUTH_TOKEN");
    const response = await axios.get(url, { headers: { Authorization: `Bearer ${SENTRY_TOKEN}` } });
    assert(response.status === 200, `请求失败，状态码：${response.status}`);
    return response.data;
}

async function parseSentryIssueId() {
    let url = await readUrlFromClipboard();
    let issueData = parseSentryUrl(url);
    if (issueData === undefined) {
        url = await readUrlFromInput();
        issueData = parseSentryUrl(url);
    }
    assert(issueData, `sentry url 解析失败，未能正常匹配到 issueId：${url}`);

    if (issueData.eventId === undefined) {
        const apiUrl = stringFormat(SENTRY_API_GET_ISSUE_EVENTS, issueData);
        const response = await callSentryApi<ISentryIssueEventsResponse>(apiUrl);
        assert(response.length > 0, "当前 issue 下未找到任何 event");
        issueData.eventId = response[0].id;
    }
    return issueData;
}

async function parseSentryEventDetail(issueId: string, eventId: string) {
    const apiUrl = stringFormat(SENTRY_API_GET_ISSUE_EVENT_DETAIL, { issueId, eventId });
    const response = await callSentryApi<ISentryIssueEventDetailResponse>(apiUrl);

    const buildNumber = response.tags.find((tag) => tag.key === "buildNumber")?.value;
    const platform = response.tags.find((tag) => tag.key === "os.name")?.value.toLowerCase() as EPlatform | undefined;

    let runtime = response.tags.find((tag) => tag.key === "runtime.js")?.value.toLowerCase() as ERuntime | undefined;
    runtime ??= ERuntime.V8;

    let stacktrace = response.entries.find((entry) => entry.type === "message")?.data.formatted;
    stacktrace ||= response.entries.find((entry) => entry.type === "exception")?.data.values[0].value;
    stacktrace ||= response.metadata.value;

    const dataValid = buildNumber && platform && stacktrace;
    assert(dataValid, `issue event 信息不完整, url: ${apiUrl}, buildNumber: ${buildNumber}, platform: ${platform}, runtime: ${runtime}, stacktrace: ${stacktrace}`);
    return { buildNumber, platform, runtime, stacktrace };
}

export async function parseSentryIssueData(): Promise<ISentryIssueEventData> {
    const { issueId, eventId } = await parseSentryIssueId();
    const { buildNumber, platform, runtime, stacktrace } = await parseSentryEventDetail(issueId, eventId);
    return { issueId, eventId, buildNumber, platform, runtime, stacktrace };
}
