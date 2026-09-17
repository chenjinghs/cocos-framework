# Sentry Log Decrypt CLI

One TypeScript CLI for Sentry log work:

- decrypt one local `log.enc`
- download and decrypt logs by player `uid`
- download and decrypt logs from one Sentry event URL

## Usage

Root command:

```bash
cd TypeScripts
yarn sentry-log-decrypt-cli
```

No-argument interactive mode first asks which action to run:

- decrypt single log
- download logs by uid
- download logs by Sentry URL

## Decrypt One Local Log

This is the default command when arguments are passed without a command:

```bash
yarn sentry-log-decrypt-cli -- --input C:/Users/me/Downloads/log.enc --output C:/Users/me/Desktop/log.log --app-version 123456 --environment prod-goatgames-aws --platform Android
```

Equivalent explicit command:

```bash
yarn sentry-log-decrypt-cli -- decrypt --input C:/Users/me/Downloads/log.enc --output C:/Users/me/Desktop/log.log --app-version 123456 --environment prod-goatgames-aws --platform Android
```

Interactive decrypt mode supports:

- input path, or Enter to open a Windows file picker
- output path, defaulting to `<input-dir>/<input-name>.log`
- `app_res_version`
- environment, selected from `ci/library/vars/getConfiguration.groovy` with a multi-line Up/Down menu
- platform, selected with a multi-line Up/Down menu

## Download By UID

```bash
yarn sentry-log-decrypt-cli -- uid --env ea --uid 10672409022 --start 2026-07-06T00:00:00Z --end 2026-07-08T00:00:00Z
```

Options:

- `--uid, -u <uid>`: player uid
- `--env <cn|hmt|ea|ru>`: Sentry credential env
- `--start <time>` / `--end <time>`: optional query time range
- `--output, -o <dir>`: parent output directory, defaulting to Downloads
- `--limit <n>`: optional max events
- `--no-bak`: skip `log.enc.bak`

Output folder: `<output>/<uid>-<current-time>/`.

Log filename: `<uid>-<event-id>-<event-time>-raw.log`; `log.enc.bak` uses `-bak.log`.

`summary.json` includes each processed log's Sentry event URL.

## Download By Sentry URL

```bash
yarn sentry-log-decrypt-cli -- url --env ea --url "https://sentry.seayoo.io/organizations/sentry/issues/603536/events/aef70ffaf5e240bab2ab156292ceb4f9/"
```

Options:

- `--url <url>`: Sentry event URL, Sentry issue URL, or a raw 32-character event id
- `--env <cn|hmt|ea|ru>`: Sentry credential env
- `--output, -o <dir>`: parent output directory, defaulting to Downloads
- `--no-bak`: skip `log.enc.bak`

Output folder: `<output>/<event-id>-<current-time>/`.

On Windows command lines, prefer the short issue/event URL without query parameters, because `&` in copied URLs can be interpreted by the shell:

```bash
yarn sentry-log-decrypt-cli -- url --env ea --url https://sentry.seayoo.io/organizations/sentry/issues/603542/
```

## Notes

- Credentials are loaded from `<repo>/.agents/.sentry.<env>.env`.
- `--environment` is normalized: lowercase and `_` becomes `-`.
- `--platform` aliases include `android`, `ios`, `iphone`, `windows`, `linux`, `macos`, and `osx`.
- Valid platform values are `Android`, `IPhonePlayer`, `WindowsPlayer`, `LinuxPlayer`, `OSXPlayer`, and `OpenHarmony`.
