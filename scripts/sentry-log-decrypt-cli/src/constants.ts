export const CLI_NAME = "sentry-log-decrypt-cli";

export const VALID_SENTRY_ENVS = ["cn", "hmt", "ea", "ru"] as const;

export const LOG_ATTACHMENT_NAMES = ["log.enc", "log.enc.bak"] as const;

export const PLATFORM_VALUE_HINT = "Android | IPhonePlayer | WindowsPlayer | LinuxPlayer | OSXPlayer | OpenHarmony";

export const PLATFORM_CHOICES = ["Android", "IPhonePlayer", "WindowsPlayer", "LinuxPlayer", "OSXPlayer", "OpenHarmony"] as const;

export const ACTION_CHOICES = ["decrypt single log", "download logs by uid", "download logs by Sentry URL"] as const;

export const FALLBACK_ENVIRONMENT_CHOICES = [
    "dev",
    "qa",
    "boss",
    "prod",
    "preview",
    "channel",
    "channel-preview",
    "lenovo",
    "dev-goatgames-aws",
    "qa-goatgames-aws",
    "preview-goatgames-aws",
    "prod-goatgames-aws",
    "test-goatgames-ru",
    "preview-goatgames-ru",
    "prod-goatgames-ru",
    "dev-goatgames-hmt",
    "qa-goatgames-hmt",
    "preview-goatgames-hmt",
    "prod-goatgames-hmt",
    "dev-happyhour-sea",
    "banhao-happyhour-vn",
] as const;
