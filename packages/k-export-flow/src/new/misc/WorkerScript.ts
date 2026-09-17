import * as fs from "fs";
import * as path from "path";

import type { WorkerOptions } from "worker_threads";

let tsxCjsLoader: string | undefined;

function getTsxCjsLoader() {
    if (tsxCjsLoader === undefined) {
        tsxCjsLoader = path.join(path.dirname(require.resolve("tsx/package.json")), "dist/cjs/index.cjs");
    }
    return tsxCjsLoader;
}

export function resolveWorkerScript(jsScriptPath: string): Pick<WorkerOptions, "execArgv"> & { filename: string } {
    const tsScriptPath = jsScriptPath.endsWith(".js") ? `${jsScriptPath.slice(0, -3)}.ts` : jsScriptPath;
    if (fs.existsSync(tsScriptPath)) {
        return {
            filename: tsScriptPath,
            execArgv: ["--require", getTsxCjsLoader()],
        };
    }
    return { filename: jsScriptPath };
}
