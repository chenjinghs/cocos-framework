import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CLI_NAME } from "../constants";
import { decryptLog } from "../crypto/decrypt-log";
import { SingleDecryptOptions } from "../types";

export function decryptSingleLog(options: SingleDecryptOptions): void {
    if (!existsSync(options.inputPath)) {
        throw new Error(`Input file does not exist: ${options.inputPath}`);
    }

    mkdirSync(dirname(options.outputPath), { recursive: true });
    const decrypted = decryptLog(readFileSync(options.inputPath), options.appVersion, options.environment, options.platform);
    writeFileSync(options.outputPath, decrypted, "utf8");
    console.log(`[${CLI_NAME}] Wrote decrypted log to ${options.outputPath}`);
}
