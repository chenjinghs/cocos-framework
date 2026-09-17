import { AnyType, LastProcessorOutputData } from "../data";
import { ExportLogger } from "../misc/ExportLogger";
import { Manager } from "../manager/Manager";
import { ensureDir, mkDir, pathExists, rmPath } from "../misc/Util";
import { Processor } from "./Base";

import type { IProcessorConfig } from "./Base";

interface IConfig extends IProcessorConfig {
    paths: string[];
}

class PrepareDir extends Processor<PrepareDir> {
    public inputDataType = AnyType;
    public outputDataType = LastProcessorOutputData;

    protected async onPreProcessAll(inputs: Array<AnyType>) {
        const { paths } = this.getConfig<IConfig>();
        const incrementBuild = Manager.getInstance().getAdditionalArg("incrementBuild") === "true";

        for (const dirPath of paths ?? []) {
            if (incrementBuild) {
                ExportLogger.logVerbose(`PrepareDir ensure ${dirPath}`);
                await ensureDir(dirPath);
            } else {
                ExportLogger.logVerbose(`PrepareDir recreate ${dirPath}`);
                if (await pathExists(dirPath)) await rmPath(dirPath);
                await mkDir(dirPath);
            }
        }

        ExportLogger.logVerbose(`PrepareDir: ${incrementBuild ? "ensured" : "recreated"} ${paths?.length ?? 0} dir(s)`);
        return inputs;
    }

    protected processSingle(data: AnyType) {
        return data;
    }
}
PrepareDir.register();
