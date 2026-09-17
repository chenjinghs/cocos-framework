import * as fs from "fs";
import * as path from "path";

import { FilePathData } from "../data";
import { ContainerField, EFieldType } from "../field/Base";
import { Manager } from "../manager/Manager";
import { ensureDir, writeFile } from "../misc/Util";
import { Processor } from "./Base";

import type { ArrayField } from "../field";
import type { Field } from "../field/Base";
import type { Schema } from "../data";
import type { IDataTableKeyConfig } from "../field/Extension";
import type { IProcessorConfig } from "./Base";

const INCREMENT_INFO_FILE_NAME = "export-csv-increment-info.json";
const TEMP_FILE_NAME = "early-filter-file-path-data-info.json";

interface IConfig extends IProcessorConfig {
    tempPath: string;
    settingFile?: string;
    enabled?: boolean;
}

interface ISavedInfo {
    version: number;
    data: FilePathData[];
}

export type EarlyFilterFilePathDataCheckFunc = (oldData: Array<FilePathData>, newData: Array<FilePathData>) => Array<FilePathData> | Promise<Array<FilePathData>>;

export function registerEarlyFilterFilePathDataCheckFunc(func: EarlyFilterFilePathDataCheckFunc) {
    EarlyFilterFilePathData.registerCustomCheck(func);
}

class EarlyFilterFilePathData extends Processor<EarlyFilterFilePathData> {
    private static customCheckFuncs: EarlyFilterFilePathDataCheckFunc[] = [];
    public static registerCustomCheck(func: EarlyFilterFilePathDataCheckFunc) {
        this.customCheckFuncs.push(func);
    }

    public inputDataType = FilePathData;
    public outputDataType = FilePathData;

    private finalPathData = new Map<string, FilePathData>();

    protected override async processSingle(data: FilePathData) {
        return data;
    }

    protected override async onPostProcessAll(outputs: Array<FilePathData>) {
        let config = this.getConfig<IConfig>();
        if (config.enabled === false) return outputs;

        const incrementBuild = Manager.getInstance().getAdditionalArg("incrementBuild") === "true";
        if (!incrementBuild) {
            await this.saveTempInfoAfterPostProcess(outputs);
            return outputs;
        }

        let incrementInfoPath = path.join(config.tempPath, INCREMENT_INFO_FILE_NAME);
        let incrementInfo: Map<string, string> | undefined;

        if (fs.existsSync(incrementInfoPath)) {
            let jsonObj = JSON.parse(fs.readFileSync(incrementInfoPath, "utf-8"));
            incrementInfo = new Map<string, string>();
            for (const key in jsonObj) {
                if (Object.hasOwn(jsonObj, key)) {
                    incrementInfo.set(key, jsonObj[key]);
                }
            }
        }

        let csvPathDataMap = new Map<string, FilePathData>();
        outputs.forEach((v) => csvPathDataMap.set(v.path, v));

        let oldSavedInfoPath = path.join(config.tempPath, TEMP_FILE_NAME);
        let oldSavedInfo: ISavedInfo | undefined;
        if (fs.existsSync(oldSavedInfoPath)) {
            oldSavedInfo = JSON.parse(fs.readFileSync(oldSavedInfoPath, "utf-8"));
        }

        this.finalPathData.clear();

        // xlsx → csv 变更
        if (incrementInfo && incrementInfo.size > 0) {
            for (let [xlsxPath] of incrementInfo) {
                let csvPath = this.deriveCsvPathFromXlsx(xlsxPath, csvPathDataMap);
                if (csvPath && csvPathDataMap.has(csvPath)) {
                    this.finalPathData.set(csvPath, csvPathDataMap.get(csvPath)!);
                }
            }
        }

        // 自定义检查（TS 文件变更等），无论 incrementInfo 是否为空都需要执行
        if (EarlyFilterFilePathData.customCheckFuncs.length > 0) {
            const oldData = oldSavedInfo?.data ?? [];
            for (const fn of EarlyFilterFilePathData.customCheckFuncs) {
                const customOutputs = await fn(oldData, outputs);
                customOutputs.forEach((v) => this.finalPathData.set(v.path, v));
            }
        }

        await this.saveTempInfoAfterPostProcess(outputs);

        if (this.finalPathData.size === 0) {
            // 无任何变更：全量通过，CollectChangedSchema 做精确哈希对比
            return outputs;
        }

        if (this.registerGenerateSchemaPostProcess()) {
            return outputs;
        } else {
            return Array.from(this.finalPathData.values());
        }
    }

    private deriveCsvPathFromXlsx(xlsxPath: string, csvPathDataMap: Map<string, FilePathData>): string | undefined {
        const xlsxBaseName = path.basename(xlsxPath, ".xlsx");
        const xlsxDir = path.dirname(xlsxPath);
        let fallback: string | undefined;

        for (const [csvPath] of csvPathDataMap) {
            const csvBaseName = path.basename(csvPath, ".csv");
            if (csvBaseName !== xlsxBaseName) continue;

            const csvDir = path.dirname(csvPath);
            if (csvDir.endsWith(xlsxDir.replace(/^[A-Z]:/, "")) || csvDir.endsWith(xlsxDir)) {
                return csvPath;
            }
            if (!fallback) fallback = csvPath;
        }

        return fallback;
    }

    private async saveTempInfoAfterPostProcess(outputs: Array<FilePathData>) {
        Manager.getInstance().setPendingCacheWrite("early-filter-file-path-data-info", async () => {
            let config = this.getConfig<IConfig>();
            await ensureDir(config.tempPath);
            await writeFile(
                path.join(config.tempPath, TEMP_FILE_NAME),
                JSON.stringify({
                    version: 1,
                    data: outputs,
                }),
            );
        });
    }

    private registerGenerateSchemaPostProcess() {
        let generateSchemaProcessor = Manager.getInstance().findProcessor("GenerateSchema");
        if (!generateSchemaProcessor) return false;

        generateSchemaProcessor.addPostProcessFunc(async (datas) => {
            const outputs = datas as Array<Schema>;
            const oldOutputs = [...outputs];
            outputs.length = 0;
            const outputsSet = new Set<Schema>();

            const schemaWithSameNames = new Map<string, Array<Schema>>();
            for (const schema of oldOutputs) {
                const schemas = schemaWithSameNames.get(schema.config.name);
                if (!schemas) schemaWithSameNames.set(schema.config.name, [schema]);
                else schemas.push(schema);
            }

            const deps = new Set<string>();
            for (const output of oldOutputs) {
                if (!this.finalPathData.has(output.source.path)) continue;
                output.fields.forEach((v) => this.collectDependency(v, deps));
                outputsSet.add(output);
                outputs.push(output);
            }

            const outputCount = outputs.length;
            for (let i = 0; i < outputCount; ++i) {
                const schemas = schemaWithSameNames.get(outputs[i].config.name);
                if (!schemas) continue;
                for (const schema of schemas) {
                    if (!outputsSet.has(schema)) { outputsSet.add(schema); outputs.push(schema); }
                }
            }

            for (const dep of deps) {
                const candidates = schemaWithSameNames.get(dep);
                if (!candidates) continue;
                for (const schema of candidates) {
                    if (!this.finalPathData.has(schema.source.path) && !outputsSet.has(schema)) {
                        outputsSet.add(schema);
                        outputs.push(schema);
                        break;
                    }
                }
            }
        });
        return true;
    }

    private collectDependency(field: Field, deps: Set<string>) {
        if (field instanceof ContainerField) {
            let container = field as ContainerField;
            container.fields.forEach((v) => this.collectDependency(v, deps));
        } else {
            switch (field.getType()) {
                case EFieldType.Array: {
                    let container = field as ArrayField;
                    this.collectDependency(container.innerField, deps);
                    return;
                }
                case EFieldType.DataTableKey: {
                    let config = field.config as IDataTableKeyConfig;
                    if (Array.isArray(config.dataTableName)) config.dataTableName.forEach((v) => deps.add(v));
                    else if (config.dataTableName) deps.add(config.dataTableName);
                    return;
                }
                default:
                    return;
            }
        }
    }

    protected override canRunInMultiThread(): boolean {
        return false;
    }
}
EarlyFilterFilePathData.register();
