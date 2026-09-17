import { EOL } from "node:os";
import { CLI_NAME, PLATFORM_VALUE_HINT } from "./constants";
import { getDownloadsDir } from "./utils/path";

export function printUsage(): void {
    process.stdout.write(`${CLI_NAME}${EOL}`);
    process.stdout.write(`Decrypt local Sentry logs or download and decrypt logs from Sentry.${EOL}${EOL}`);
    process.stdout.write(`Usage:${EOL}`);
    process.stdout.write(`  yarn ${CLI_NAME} -- --input <log.enc> --output <log.log> --app-version <n> --environment <env> --platform <platform>${EOL}`);
    process.stdout.write(`  yarn ${CLI_NAME} -- decrypt --input <log.enc> --output <log.log> --app-version <n> --environment <env> --platform <platform>${EOL}`);
    process.stdout.write(`  yarn ${CLI_NAME} -- uid --env ea --uid 10672409022 --start 2026-07-06T00:00:00Z --end 2026-07-08T00:00:00Z${EOL}`);
    process.stdout.write(`  yarn ${CLI_NAME} -- url --env ea --url <sentry-event-url>${EOL}`);
    process.stdout.write(`  yarn ${CLI_NAME}${EOL}${EOL}`);
    process.stdout.write(`Commands:${EOL}`);
    process.stdout.write(`  decrypt              Decrypt one local log file. This is also the default command when arguments are passed without a command.${EOL}`);
    process.stdout.write(`  uid                  Download and decrypt all log.enc/log.enc.bak attachments for one player uid.${EOL}`);
    process.stdout.write(`  url                  Download and decrypt log.enc/log.enc.bak attachments for one Sentry event URL.${EOL}${EOL}`);
    process.stdout.write(`Decrypt options:${EOL}`);
    process.stdout.write(`  --input, -i          Encrypted log file path.${EOL}`);
    process.stdout.write(`  --output, -o         Output text file path.${EOL}`);
    process.stdout.write(`  --app-version, -a    app_res_version used to generate the key.${EOL}`);
    process.stdout.write(`  --environment, -e    Environment seed. Accepts prod_goatgames_aws or prod-goatgames-aws.${EOL}`);
    process.stdout.write(`  --platform, -p       Platform seed. Valid values: ${PLATFORM_VALUE_HINT}.${EOL}${EOL}`);
    process.stdout.write(`Download options:${EOL}`);
    process.stdout.write(`  --env <cn|hmt|ea|ru> Sentry credential env. Defaults from repository path.${EOL}`);
    process.stdout.write(`  --uid, -u <uid>      Player uid for the uid command.${EOL}`);
    process.stdout.write(`  --url <url>          Sentry event URL, issue URL, or raw 32-character event id.${EOL}`);
    process.stdout.write(`  --start <time>       Optional start time. Date-only values are treated as 00:00:00Z.${EOL}`);
    process.stdout.write(`  --end <time>         Optional end time. Date-only values are treated as 23:59:59Z.${EOL}`);
    process.stdout.write(`  --output, -o <dir>   Parent output directory. Default: ${getDownloadsDir()}${EOL}`);
    process.stdout.write(`  --limit <n>          Optional max events for the uid command.${EOL}`);
    process.stdout.write(`  --no-bak             Skip log.enc.bak attachments.${EOL}`);
}
