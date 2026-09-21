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

    protected async onPreProcessAll(inputs: Array<DataWithSchema>) {
        // 产物命名空间守卫:duplicate-schema-name 守的是 schema 名,不是文件基名——
        // 不同子目录下的同名表(schema 已按层命中)会映射到同一产物路径,后写覆盖先写。
        // 这里先把全部 target 解析一遍,冲突当场报出两个源文件,而不是静默丢一张表。
        let targetToSource = new Map<string, string>();
        for (const data of inputs) {
            let source = getSchemaTargetMappingSource(data.schema);
            let target = await this.targetMapping!.getTarget(source);
            if (!target) continue; // 目标解析失败由 processSingle 报自己的错

            let found = targetToSource.get(target);
            assertWithLoc(found === undefined, "duplicate-output-path", { path: target, source1: found ?? "", source2: source });
            targetToSource.set(target, source);
        }
        return inputs;
    }
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
