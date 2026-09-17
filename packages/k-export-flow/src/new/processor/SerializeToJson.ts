import * as fs from "fs";

import { DataWithSchema, JsonFileExtraData } from "../data";
import { assertWithLoc, ExportLogger, ExportRunStats, formatLoc, jsonStringify, writeFile } from "../misc";
import { Processor } from "./Base";
import { getSchemaTargetMappingSource, removeFileAndVerifyDir } from "./Util";

import type { ITargetMappingConfig } from "../misc/TargetMapping";
import type { IProcessorConfig } from "./Base";
interface IConfig extends IProcessorConfig {
    targetMapping: ITargetMappingConfig;
    outputLog: boolean;
    exportMeta?: boolean;
}

class SerializeToJson extends Processor<SerializeToJson> {
    public inputDataType = DataWithSchema;
    public outputDataType = DataWithSchema;

    public async processSingle(data: DataWithSchema) {
        let config = this.getConfig<IConfig>();
        let outputObj = data.getData() as any;
        if (!outputObj) {
            console.warn(`SerializeToJson failed, output object is null, source path: ${data.getSourcePath()}`);
            return data;
        }

        let targetPath = await this.targetMapping!.getTarget(getSchemaTargetMappingSource(data.schema));
        assertWithLoc(targetPath, "write-data-to-json-failed-target-path-invalid", {
            file: targetPath,
        });

        let content = jsonStringify(outputObj, config.exportMeta);

        await this.recordFileChange(targetPath!, content);
        await removeFileAndVerifyDir(targetPath);
        await writeFile(targetPath!, content);

        if (config.outputLog) ExportLogger.logVerbose(formatLoc("write-data-to-json-succeed", { file: targetPath }));
        data.addExtraData(new JsonFileExtraData(targetPath!));

        return data;
    }

    protected getTargetMappingConfig(): ITargetMappingConfig | undefined {
        return this.getConfig<IConfig>().targetMapping;
    }

    protected canRunInMultiThread(): boolean {
        return true;
    }

    private async recordFileChange(targetPath: string, content: string): Promise<void> {
        if (!fs.existsSync(targetPath)) {
            ExportRunStats.getInstance().recordAdded(targetPath);
            return;
        }
        const old = await fs.promises.readFile(targetPath, "utf-8");
        if (old !== content) ExportRunStats.getInstance().recordModified(targetPath);
    }
}
SerializeToJson.register();
