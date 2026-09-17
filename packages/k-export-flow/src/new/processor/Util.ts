import * as path from "path";

import { DataWithSchema, Schema } from "../data/Data";
import { assertWithLoc } from "../misc/Localization";
import { TargetMapping } from "../misc/TargetMapping";
import { deepCopy, ensureDir, pathExists, rmPath } from "../misc/Util";
import { ESchemaDataType } from "../schema/Base";
import { DataPostProcess, DEFAULT_POST_PROCESS_PRIORITY } from "./PostProcess";

import type { ISchemaConfig } from "../schema/Base";
import type { ITargetMappingConfig } from "../misc/TargetMapping";
import type { PostProcessAllFunc, PostProcessSingleFunc } from "./PostProcess";

interface ISchemaTargetMappingConfig extends ISchemaConfig {
    outputMappingSource?: string;
}

export function getSchemaValueWithKey(schema: Schema, mappingFileKeyInSchema: string) {
    assertWithLoc(mappingFileKeyInSchema !== undefined, "invalid-param-in-schema-file", {
        name: "mappingFileKeyInSchema",
        schema: schema.schemaFiles,
    });

    return schema.config[mappingFileKeyInSchema];
}

export async function getTargetPathWithMappingBySchemaKey(schema: Schema, mappingFileKeyInSchema: string, targetMappingConfig: ITargetMappingConfig) {
    let mappingKey = getSchemaValueWithKey(schema, mappingFileKeyInSchema);
    assertWithLoc(mappingKey && typeof mappingKey === "string", "invalid-param-in-schema-file", {
        name: "mappingFileKeyInSchema",
        schema: schema.schemaFiles,
    });

    let targetMapping = await TargetMapping.create(targetMappingConfig);
    assertWithLoc(targetMapping, "invalid-target-mapping", {
        type: targetMappingConfig.type,
        location: "getTargetPathWithMappingBySchemaKey",
    });

    return await targetMapping.getTargets(mappingKey);
}

export function getSchemaTargetMappingSource(schema: Schema) {
    let config = schema.getConfig<ISchemaTargetMappingConfig>();
    return config.outputMappingSource ?? schema.schemaFiles[0];
}

export function registerDataPostProcess(key: string, func: PostProcessSingleFunc) {
    DataPostProcess.registerDataPostProcess(key, func);
}

export function registerAllDataPostProcess(
    processorName: string,
    func: PostProcessAllFunc,
    order = DEFAULT_POST_PROCESS_PRIORITY,
) {
    DataPostProcess.registerAllDataPostProcess(processorName, func, order);
}

export async function removeFileAndVerifyDir(inPath: string) {
    if (await pathExists(inPath)) await rmPath(inPath);
    let dir = path.dirname(inPath);
    await ensureDir(dir);
}

export function createFakeDataTable(tableName: string, fakeSettingPath: string, data: object, tag?: string, sourceConfig?: any) {
    let schema = Schema.create(ESchemaDataType.DataTable)!;
    let newConfig = sourceConfig ? deepCopy(sourceConfig) : {};
    newConfig.type = ESchemaDataType.DataTable;
    newConfig.name = tableName;
    newConfig.fields = [];
    newConfig.tag = tag;

    schema.config = newConfig;
    schema.schemaFiles = [fakeSettingPath];
    schema.generateFields();

    let newOutput = new DataWithSchema(data, schema);
    newOutput.sourcePath = newConfig.name;
    return newOutput;
}

export class DataCache {
    private static s_instance = new DataCache();
    public static get() {
        return DataCache.s_instance;
    }

    private _cache: Map<string, any> = new Map();
    private _unUsed: Set<string> = new Set();
    private _preFetch = new Map<string, any>();

    public cache(data: any, key: string) {
        this._cache.set(key, data);
    }

    public fetch(key: string, cloneNew = true) {
        let cache = this._cache.get(key);
        if (!cache) return;

        this._unUsed.delete(key);
        if (cloneNew) {
            let preFetchResult = this._preFetch.get(key);
            if (preFetchResult) {
                this._preFetch.delete(key);
                return preFetchResult;
            }

            let startTime = Date.now();
            cache = deepCopy(cache);
            let time = (Date.now() - startTime) / 1000;
            if (time > 0.5) console.log(`clone cache: ${key}, too long time: ${time} s`);
            return cache;
        } else {
            return cache;
        }
    }

    // 因为数据比较大，deepCopy会比较耗时，所以提前clone一份
    public preFetchAll() {
        let startTime = Date.now();
        for (let [key, data] of this._cache) {
            if (this._preFetch.has(key)) continue;
            this._preFetch.set(key, deepCopy(data));
        }
        let time = (Date.now() - startTime) / 1000;
        console.log(`pre-fetch cache time: ${time} s`);
    }

    public clearAll() {
        this._cache.clear();
    }

    public setUnused() {
        for (let [key, _] of this._cache) {
            this._unUsed.add(key);
        }
    }

    public clearUnused() {
        for (let key of this._unUsed) {
            this._cache.delete(key);
        }
        this._unUsed.clear();
    }
}
