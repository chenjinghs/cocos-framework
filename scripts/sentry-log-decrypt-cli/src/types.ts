import { VALID_SENTRY_ENVS } from "./constants";

export type SentryEnv = (typeof VALID_SENTRY_ENVS)[number];

export type SingleDecryptOptions = {
    inputPath: string;
    outputPath: string;
    appVersion: number;
    environment: string;
    platform: string;
};

export type UidDownloadOptions = {
    uid: string;
    env: SentryEnv;
    start?: string;
    end?: string;
    outputDir: string;
    limit?: number;
    includeBak: boolean;
};

export type UrlDownloadOptions = {
    url: string;
    target: SentryUrlTarget;
    env: SentryEnv;
    outputDir: string;
    includeBak: boolean;
};

export type SentryUrlTarget =
    | {
          kind: "event";
          eventId: string;
      }
    | {
          kind: "issue";
          issueId: string;
      };

export type SentryConfig = {
    baseUrl: string;
    org: string;
    project: string;
    authToken: string;
};

export type SentryEvent = {
    id: string;
    timestamp?: string;
    title?: string;
    uid?: string;
};

export type SentryProject = {
    id: string;
    slug: string;
};

export type SentryEventDetail = {
    id: string;
    groupID?: string;
    groupId?: string;
    dateCreated?: string;
    tags?: Array<{ key?: string; value?: string }>;
};

export type SentryAttachment = {
    id: string;
    name: string;
    size: number;
};

export type DownloadResult = {
    uid: string;
    eventId: string;
    eventTime: string;
    sentryUrl: string;
    attachment: string;
    outputPath?: string;
    status: "downloaded" | "skipped" | "failed";
    error?: string;
};
