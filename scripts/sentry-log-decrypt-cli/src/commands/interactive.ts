import { ACTION_CHOICES } from "../constants";
import { decryptSingleLog } from "./decrypt";
import { runUidDownload, runUrlDownload } from "./download";
import { promptSingleDecryptOptions, promptUidDownloadOptions, promptUrlDownloadOptions } from "../prompt/prompts";
import { selectValue } from "../prompt/select";

export async function runInteractive(): Promise<number> {
    const action = await selectValue("action", [...ACTION_CHOICES], 0, (value) => value);
    switch (action) {
        case "decrypt single log":
            decryptSingleLog(await promptSingleDecryptOptions());
            return 0;
        case "download logs by uid":
            return await runUidDownload(await promptUidDownloadOptions());
        case "download logs by Sentry URL":
            return await runUrlDownload(await promptUrlDownloadOptions());
        default:
            throw new Error(`Unknown action: ${action}`);
    }
}
