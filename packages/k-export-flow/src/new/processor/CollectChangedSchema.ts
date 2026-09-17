import * as fs from "fs";
import * as jsonUtil from "json-util";
import * as path from "path";

import { ContainerField, EFieldType } from "../field/Base";
import { ensureDir, generateMD5, writeFile } from "../misc/Util";
import { Manager } from "../manager/Manager";
import { Schema } from "../schema/Base";
import { Processor } from "./Base";
import { PostProcessDependencyRegistry } from "./PostProcessDependencyRegistry";

import type { FilePathData } from "../data/Data";
import type { ArrayField } from "../field";
import type { Field } from "../field/Base";
import type { IDataTableKeyConfig } from "../field/Extension";
import type { IProcessorConfig } from "./Base";
const TEMP_FILE_NAME = "filter-changed-schema.json";
export const COLLECT_CHANGED_SCHEMA_CACHE_VERSION = 1;

interface IConfig extends IProcessorConfig {
    tempPath: string;
    enabled?: boolean;
}

interface ISavedInfo {
    version?: number;
    data: FilePathData[];
    configHashes?: Record<string, string>;
}

export type CollectChangedSchemaCheckFunc = (oldData: Array<FilePathData>, newData: Array<FilePathData>) => Array<FilePathData> | Promise<Array<FilePathData>>;

export function registerCollectChangedSchemaCheckFunc(func: CollectChangedSchemaCheckFunc) {
    CollectChangedSchema.registerCustomCheck(func);
}

export class CollectChangedSchema extends Processor<CollectChangedSchema> {
    private static dependencyRegistry: PostProcessDependencyRegistry | null = null;

    public static setDependencyRegistry(registry: PostProcessDependencyRegistry) {
        CollectChangedSchema.dependencyRegistry = registry;
    }

    private static customCheckFuncs: CollectChangedSchemaCheckFunc[] = [];
    public static registerCustomCheck(func: CollectChangedSchemaCheckFunc) {
        this.customCheckFuncs.push(func);
    }

    public inputDataType = Schema;
    public outputDataType = Schema;

    protected override async processSingle(data: Schema) {
        return data;
    }

    protected override async onPostProcessAll(outputs: Array<Schema>) {
        let config = this.getConfig<IConfig>();
        if (config.enabled === false) return outputs;

        for (const schema of outputs) {
            schema.configHash = generateMD5(JSON.stringify(schema.config));
        }

        const incrementBuild = Manager.getInstance().getAdditionalArg("incrementBuild") === "true";
        if (!incrementBuild) {
            await this.saveTempInfoAfterPostProcess(outputs);
            return outputs;
        }

        let oldSavedInfoPath = path.join(config.tempPath, TEMP_FILE_NAME);
        let oldSavedInfo: ISavedInfo | undefined;
        let oldPathData = new Map<string, FilePathData>();
        let oldConfigHashes: Record<string, string> = {};
        if (fs.existsSync(oldSavedInfoPath)) {
            const parsedSavedInfo = jsonUtil.parse(fs.readFileSync(oldSavedInfoPath, "utf-8")) as ISavedInfo;
            if (parsedSavedInfo.version === COLLECT_CHANGED_SCHEMA_CACHE_VERSION) {
                oldSavedInfo = parsedSavedInfo;
                oldSavedInfo.data?.forEach((v) => oldPathData.set(v.path, v));
                oldConfigHashes = oldSavedInfo.configHashes ?? {};
            }
        }

        // 如果之前没有记录，或缓存版本已过期，则全导
        if (!oldSavedInfo) {
            await this.saveTempInfoAfterPostProcess(outputs);
            return outputs;
        }

        let pathToOutput = new Map<string, Schema>();
        let newPathToOutput = new Map<string, Schema>();

        outputs.forEach((v) => pathToOutput.set(v.source.path, v));
        for (let data of outputs) {
            let oldData = oldPathData.get(data.source.path);
            if (oldData?.hash !== data.source.hash || oldConfigHashes[data.source.path] !== data.configHash) {
                newPathToOutput.set(data.source.path, data);
            }
        }

        if (CollectChangedSchema.customCheckFuncs.length > 0) {
            const outputFileData = outputs.map((v) => v.source);
            for (const fn of CollectChangedSchema.customCheckFuncs) {
                const customOutputs = await fn(oldSavedInfo.data, outputFileData);
                customOutputs.forEach((v) => newPathToOutput.set(v.path, pathToOutput.get(v.path)!));
            }
        }

        let reverseDeps: Map<string, Set<string>> = new Map();
        if (CollectChangedSchema.dependencyRegistry) {
            reverseDeps = CollectChangedSchema.dependencyRegistry.getReverseGraph();
        }

        let changedSchemas = new Set<Schema>(Array.from(newPathToOutput.values()));
        let resultSchemas = this.collectChangedSchemas(changedSchemas, reverseDeps, outputs);

        await this.saveTempInfoAfterPostProcess(outputs);
        return Array.from(resultSchemas);
    }

    private async saveTempInfoAfterPostProcess(outputs: Array<Schema>) {
        Manager.getInstance().setPendingCacheWrite("filter-changed-schema", async () => {
            let config = this.getConfig<IConfig>();
            let filePathDataArray = new Array<FilePathData>();
            let configHashes: Record<string, string> = {};
            outputs.forEach((v) => {
                filePathDataArray.push(v.source);
                if (v.configHash !== undefined) configHashes[v.source.path] = v.configHash;
            });

            await ensureDir(config.tempPath);
            await writeFile(
                path.join(config.tempPath, TEMP_FILE_NAME),
                jsonUtil.stringify({
                    version: COLLECT_CHANGED_SCHEMA_CACHE_VERSION,
                    data: filePathDataArray,
                    configHashes,
                }),
            );
        });
    }

    private collectChangedSchemas(changedSchemas: Set<Schema>, reverseDeps: Map<string, Set<string>>, allSchemas: Schema[]): Set<Schema> {
        const result = new Set<Schema>();
        const queue = new Array<Schema>();
        const nameToSchema = new Map(allSchemas.map((schema) => [schema.config.name, schema]));
        const registry = CollectChangedSchema.dependencyRegistry;

        const addSchema = (schema: Schema | undefined) => {
            if (!schema || result.has(schema)) return;
            result.add(schema);
            queue.push(schema);
        };

        const addSchemaByName = (name: string) => addSchema(nameToSchema.get(name));

        // 确保处理器 processorName 被触发时，其所有依赖（readsTables + csvGroups 文件）都在本次 build 里
        const ensureProcessorDeps = (processorName: string) => {
            registry?.getProcessorTables(processorName)?.forEach(addSchemaByName);
            const regexes = registry?.getProcessorCsvGroupRegexes(processorName);
            if (regexes && regexes.length > 0) {
                for (const s of allSchemas) {
                    if (regexes.some((r) => r.test(s.source.path))) {
                        addSchema(s);
                    }
                }
            }
        };

        changedSchemas.forEach(addSchema);

        let head = 0;
        while (head < queue.length) {
            const schema = queue[head++];

            // 反向依赖：表 T 变更 → 依赖 T 的处理器 P 触发 → 确保 P 的全部依赖（readsTables + csvGroups）都在本次 build 里
            const dependents = reverseDeps.get(schema.config.name);
            if (dependents) {
                for (const depName of dependents) {
                    addSchemaByName(depName);
                    ensureProcessorDeps(depName);
                }
            }

            const tableKeyDeps = new Set<string>();
            schema.fields.forEach((field) => this.collectDependency(field, tableKeyDeps));
            tableKeyDeps.forEach(addSchemaByName);

            // 正向依赖展开：若存在与该表同名的全局处理器，确保其所有依赖（readsTables + csvGroups）在本次 build 里
            if (registry) ensureProcessorDeps(schema.config.name);

            // csvGroups 触发：若该 schema 的源文件路径匹配某处理器的 csvGroups，确保该处理器所有依赖也在本次 build 里
            if (registry) {
                for (const processorName of registry.getAllProcessors()) {
                    const regexes = registry.getProcessorCsvGroupRegexes(processorName);
                    if (!regexes || regexes.length === 0) continue;
                    if (regexes.some((r) => r.test(schema.source.path))) {
                        ensureProcessorDeps(processorName);
                    }
                }
            }
        }

        return result;
    }

    private collectDependency(field: Field, deps: Set<string>) {
        if (field instanceof ContainerField) {
            let container = field as ContainerField;
            container.fields.forEach((v) => this.collectDependency(v, deps));
        } else {
            switch (field.getType()) {
                // case EFieldType.Struct:
                // case EFieldType.OneOf:
                // case EFieldType.Map: {
                //     let container = field as ContainerField;
                //     container.fields.forEach((v) => this.collectDependency(v, deps));
                //     return;
                // }
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
CollectChangedSchema.register();
