#!/usr/bin/env node

import { EOL } from "node:os";
import { parseSingleDecryptArgs, parseUidDownloadArgs, parseUrlDownloadArgs } from "./parsing/args";
import { decryptSingleLog } from "./commands/decrypt";
import { runInteractive } from "./commands/interactive";
import { runUidDownload, runUrlDownload } from "./commands/download";
import { printUsage } from "./usage";

async function main(args: string[]): Promise<number> {
    try {
        if (args.length === 0) {
            return await runInteractive();
        }

        const [command, ...commandArgs] = args;
        if (command === "--help" || command === "-h") {
            printUsage();
            return 0;
        }

        if (commandArgs.includes("--help") || commandArgs.includes("-h")) {
            printUsage();
            return 0;
        }

        switch (command) {
            case "uid":
            case "download-uid":
                return await runUidDownload(parseUidDownloadArgs(commandArgs));
            case "url":
            case "event-url":
                return await runUrlDownload(parseUrlDownloadArgs(commandArgs));
            case "decrypt":
                decryptSingleLog(parseSingleDecryptArgs(commandArgs));
                return 0;
            default:
                decryptSingleLog(parseSingleDecryptArgs(args));
                return 0;
        }
    } catch (error) {
        process.stderr.write(`${error instanceof Error ? error.message : String(error)}${EOL}`);
        return 1;
    }
}

void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
});
