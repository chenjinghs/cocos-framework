/* eslint-disable no-template-curly-in-string */

import fs from "node:fs";
import path from "node:path";

// 优先从环境变量读取(与 upload-sourcemaps 的约定一致);不要把 token 提交进仓库。
// 注意:历史上曾硬编码在代码里的 token 应视为已泄露,请轮换。
export const SENTRY_TOKEN = process.env.SENTRY_AUTH_TOKEN ?? "";

export let TS_PROJECT_ROOT: string = "";
try {
    TS_PROJECT_ROOT = process.env.TS_PROJECT_ROOT ?? path.resolve(__dirname, "../../../TypeScripts");
} catch (error) {
    TS_PROJECT_ROOT = process.env.TS_PROJECT_ROOT ?? path.resolve(import.meta.dirname, "../../../"); // Typescripts 目录
}

export enum EPlatform {
    Android = "android",
    IOS = "ios",
    Windows = "windows",
}

export enum ERuntime {
    Wechat = "wechat",
    V8 = "v8",
}

export const SOURCEMAP_RELOCATE_MAPPING: Record<ERuntime, Record<EPlatform, Record<string, string>>> = {
    [ERuntime.Wechat]: {
        [EPlatform.Android]: {
            "https://usr/game.js": "__APP__/game.js",
            "https://usr/": "",
        },
        [EPlatform.IOS]: {
            "weapp://wechat-game-runtime/wxfs//game.js": "__APP__/game.js",
            "weapp://wechat-game-runtime/wxfs//": "",
        },
        [EPlatform.Windows]: {
            "https://usr/game.js": "__FULL__/game.js",
        },
    },
    [ERuntime.V8]: {
        [EPlatform.Android]: {
            "file:///packages.zip/": "packages/",
        },
        [EPlatform.IOS]: {
            "file:///packages.zip/": "packages/",
        },
        [EPlatform.Windows]: {
            "file:///packages.zip/": "packages/",
        },
    },
};

export const SOURCE_RELOCATE_MAPPING = {
    [ERuntime.Wechat]: {
        trimPrefix: "webpack:///",
        isRelativeToMap: false,
    },
    [ERuntime.V8]: {
        trimPrefix: "",
        isRelativeToMap: true,
    },
};

export const SENTRY_API_GET_ISSUE_EVENTS = "https://sentry.seayoo.com/api/0/organizations/sentry/issues/${issueId}/events/";

export const SENTRY_API_GET_ISSUE_EVENT_DETAIL = "https://sentry.seayoo.com/api/0/organizations/sentry/issues/${issueId}/events/${eventId}/";

export type ISentryIssueEventsResponse = { id: string }[];

export type ISentryIssueEventDetailResponse = {
    entries: ({ type: "message"; data: { formatted: string } } | { type: "exception"; data: { values: { value: string }[] } })[];
    tags: { key: string; value: string }[];
    metadata: { value: string };
};

export type ISentryIssueEventData = {
    issueId: string;
    eventId: string;
    buildNumber: string;
    platform: EPlatform;
    runtime: ERuntime;
    stacktrace: string;
};

let config: { DEBUG_MODE?: boolean; SAVE_RESULT?: boolean; FULL_LOCAL_PATH?: boolean } = {};
let configPath = path.resolve(process.cwd(), "config.json");
if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
}
export const CONFIG = config;
