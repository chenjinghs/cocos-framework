import * as fs from "fs";
import * as jsonUtil from "json-util";
import * as path from "path";
import * as yaml from "yaml";

import { FilePathData } from "../data";
import { ContainerField, EFieldType } from "../field/Base";
import { Manager } from "../manager/Manager";
import { assert, ensureDir, writeFile } from "../misc/Util";
import { Processor } from "./Base";

import type { ArrayField } from "../field";
import type { Field } from "../field/Base";
import type { Schema } from "../data";
import type { IDataTableKeyConfig } from "../field/Extension";
import type { IProcessorConfig } from "./Base";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const TEMP_FILE_NAME = "filter-changed-file-path-data-info.json";

interface IGroupConfig {
    name: string;
    includeRegex?: string[];
    excludeRegex?: string[];
}

interface ISettingConfig {
    version: number;
    groups: IGroupConfig[];
}

interface IConfig extends IProcessorConfig {
    tempPath: string;
    groupSetting: string;
    settingFile?: string;
    enabled?: boolean;
}

interface ISavedInfo {
    version: number;
    data: FilePathData[];
}

export type FilterChangedFilePathDataCheckFunc = (oldData: Array<FilePathData>, newData: Array<FilePathData>) => Array<FilePathData> | Promise<Array<FilePathData>>;

export function registerFilterChangedFilePathDataCheckFunc(func: FilterChangedFilePathDataCheckFunc) {
    FilterChangedFilePathData.registerCustomCheck(func);
}

class FilterChangedFilePathData extends Processor<FilterChangedFilePathData> {
    private static customCheckFuncs: FilterChangedFilePathDataCheckFunc[] = [];
    public static registerCustomCheck(func: FilterChangedFilePathDataCheckFunc) {
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

        let setting: ISettingConfig | undefined;
        if (config.settingFile) {
            if (!fs.existsSync(config.settingFile)) throw new Error(`setting file not exist: ${config.settingFile}`);
            setting = yaml.parse(fs.readFileSync(config.settingFile, "utf-8"));
        }

        let oldSavedInfoPath = path.join(config.tempPath, TEMP_FILE_NAME);
        let oldSavedInfo: ISavedInfo | undefined;
        let oldPathData = new Map<string, FilePathData>();
        if (fs.existsSync(oldSavedInfoPath)) {
            oldSavedInfo = jsonUtil.parse(fs.readFileSync(oldSavedInfoPath, "utf-8"));
            oldSavedInfo!.data.forEach((v) => oldPathData.set(v.path, v));
        }

        // 如果之前没有记录或者版本不一样则全导
        if (!oldSavedInfo || (setting && oldSavedInfo.version !== setting.version)) {
            await this.saveTempInfoAfterPostProcess(setting, outputs);
            return outputs;
        }

        let newPathData = new Map<string, FilePathData>();
        outputs.forEach((v) => newPathData.set(v.path, v));

        this.finalPathData.clear();
        for (let data of outputs) {
            let oldData = oldPathData.get(data.path);
            if (oldData?.hash !== data.hash) {
                this.finalPathData.set(data.path, data);
            }
        }

        for (const fn of FilterChangedFilePathData.customCheckFuncs) {
            const customOutputs = await fn(oldSavedInfo.data, outputs);
            customOutputs.forEach((v) => this.finalPathData.set(v.path, v));
        }

        // 匹配组
        this.matchGroups(setting, this.finalPathData, newPathData);
        await this.saveTempInfoAfterPostProcess(setting, outputs);

        // 全生成schema后再筛选需要的，因为有schema后才能处理依赖
        if (this.registerGenerateSchemaPostProcess()) {
            return outputs;
        } else {
            return Array.from(this.finalPathData.values());
        }
    }

    private matchGroups(setting: ISettingConfig | undefined, changedFileData: Map<string, FilePathData>, originalFileData: Map<string, FilePathData>) {
        if (!setting?.groups || setting.groups.length === 0) return;

        let config = this.getConfig<IConfig>();
        let groupIndices = new Map<string, number>();
        for (let i = 0; i < setting.groups.length; ++i) {
            assert(groupIndices.has(setting.groups[i].name) === false, `duplicated group name ${setting.groups[i].name} in ${config.settingFile}`);
            groupIndices.set(setting.groups[i].name, i);
        }

        function match(filePath: string, group: IGroupConfig) {
            let matched = false;
            if (group.includeRegex) {
                for (let regex of group.includeRegex) {
                    if (new RegExp(regex).test(filePath)) {
                        matched = true;
                        break;
                    }
                }
            }
            if (group.excludeRegex) {
                for (let regex of group.excludeRegex) {
                    if (new RegExp(regex).test(filePath)) {
                        matched = false;
                        break;
                    }
                }
            }
            return matched;
        }

        let files = changedFileData.keys();
        for (let filePath of files) {
            let matchedGroup: IGroupConfig | undefined;
            for (let group of setting.groups) {
                if (!match(filePath, group)) continue;

                matchedGroup = group;
                break;
            }

            if (matchedGroup) {
                for (let [k, v] of originalFileData) {
                    if (k === filePath) continue;
                    if (changedFileData.has(k)) continue;

                    if (match(k, matchedGroup)) {
                        changedFileData.set(k, v);
                    }
                }
            }
        }
    }

    private async saveTempInfoAfterPostProcess(setting: ISettingConfig | undefined, outputs: Array<FilePathData>) {
        Manager.getInstance().setPendingCacheWrite("filter-changed-file-path-data-info", async () => {
            let config = this.getConfig<IConfig>();
            await ensureDir(config.tempPath);
            await writeFile(
                path.join(config.tempPath, TEMP_FILE_NAME),
                jsonUtil.stringify({
                    version: setting?.version ?? 1,
                    data: outputs,
                }),
            );
        });
    }

    private registerGenerateSchemaPostProcess() {
        // 要在生成完schema后再解析依赖项，然后在补充依赖的schema
        let generateSchemaProcessor = Manager.getInstance().findProcessor("GenerateSchema");
        if (!generateSchemaProcessor) return false;

        generateSchemaProcessor.addPostProcessFunc(async (datas) => {
            let outputs = datas as Array<Schema>;
            let oldOutputs = new Array<Schema>(...outputs);
            outputs.length = 0;

            let schemaWithSameNames = new Map<string, Array<Schema>>();
            for (let schema of oldOutputs) {
                let schemas = schemaWithSameNames.get(schema.config.name);
                if (!schemas) {
                    schemas = new Array<Schema>();
                    schemaWithSameNames.set(schema.config.name, schemas);
                }
                schemas.push(schema);
            }

            let deps = new Set<string>();
            for (let output of oldOutputs) {
                if (!this.finalPathData.has(output.source.path)) continue;

                output.fields.forEach((v) => this.collectDependency(v, deps));
                outputs.push(output);
            }

            let outputCount = outputs.length;
            for (let i = 0; i < outputCount; ++i) {
                let output = outputs[i];
                let schemas = schemaWithSameNames.get(output.config.name);
                if (!schemas) continue;

                for (let schema of schemas) {
                    if (!outputs.includes(schema)) outputs.push(schema);
                }
            }

            for (let dep of deps) {
                let schema = oldOutputs.find((v) => v.config.name === dep && !this.finalPathData.has(v.source.path));
                if (schema && !outputs.includes(schema)) outputs.push(schema);
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
}
FilterChangedFilePathData.register();
