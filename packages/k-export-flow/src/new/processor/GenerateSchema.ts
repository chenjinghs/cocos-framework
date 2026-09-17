import * as merge from "merge";
import * as path from "path";

import { FilePathData } from "../data";
import { assertWithLoc, deepCopy, getFileBaseName, getFileExtension, pathExists } from "../misc";
import { Loader } from "../misc/Loader";
import { EXTENSION_TO_SCHEMA_TYPE, Schema } from "../schema/Base";
import { Processor } from "./Base";
import { DataPostProcess } from "./PostProcess";

import type { ITargetMappingConfig, TargetMapping } from "../misc/TargetMapping";
import type { ISchemaConfig } from "../schema/Base";
import type { IProcessorConfig } from "./Base";
import type { IAdditionalDataProcessConfig } from "./PostProcess";

interface IConfig extends IProcessorConfig {
    extensions: Array<string>;
    targetMapping: ITargetMappingConfig;
    schemaAliasFile?: string;
}

interface ISchemaAliasInfo {
    sourceBaseName: string;
    schemaBaseName: string;
    nameOverride?: string;
    disableDataPostProcess?: boolean;
}

interface ISchemaAliasFileConfig {
    aliases?: ISchemaAliasInfo[];
}

interface ISchemaConfigWithAlias extends ISchemaConfig {
    exportToTS?: boolean;
    useSchemaConfigNameAsKey?: boolean;
    outputMappingSource?: string;
    additionalDataPostProcess?: IAdditionalDataProcessConfig;
    additionalDataPostProcessList?: IAdditionalDataProcessConfig[];
}

class GenerateSchema extends Processor<GenerateSchema> {
    public inputDataType = FilePathData;
    public outputDataType = Schema;
    private schemaAliasInfoMap = new Map<string, ISchemaAliasInfo>();
    private schemaAliasInfoPromise?: Promise<void>;

    public async processSingle(data: FilePathData) {
        let config = this.getConfig<IConfig>();
        let extToLoader = new Map<string, Loader>();

        for (const ext of config.extensions) {
            let loader = Loader.create(ext);
            assertWithLoc(loader, "invalid-loader", { phase: "GenerateSchema", ext: ext });
            extToLoader.set(ext, loader);
        }

        return await this.generateSchema(data, extToLoader, this.targetMapping!);
    }

    protected async onPostProcessAll(outputs: Array<Schema>) {
        // 验证是否有同类型重名的schema
        // 必须先按 source path 排序，确保 multiSource 重命名在不同运行间一致
        // （ConvertExcelToCsv 并行创建 CSV 文件导致文件顺序非确定性）
        outputs.sort((a, b) => a.source.path.localeCompare(b.source.path));

        let schemasWithType = new Map<unknown, Map<string, Schema>>();
        let newOutputs = new Array<Schema>();

        for (const schema of outputs) {
            let schemas = schemasWithType.get(schema.constructor);
            if (!schemas) {
                schemas = new Map<string, Schema>();
                schemasWithType.set(schema.constructor, schemas);
            }

            let found = schemas.get(schema.config.name);
            if (found && found.getConfig().multiSource) {
                // if (config.mergeSourceList.indexOf(schema.config.name) >= 0) {
                schema.config.name = schema.config.name + "_" + path.basename(schema.source.path, path.extname(schema.source.path));
                found = undefined;
                // }
            }

            assertWithLoc(!found, "duplicate-schema-name", {
                name: schema.config.name,
                path1: schema.source.path,
                path2: found?.source.path,
            });

            schemas.set(schema.config.name, schema);
            newOutputs.push(schema);
        }

        return newOutputs;
    }

    private async generateSchema(source: FilePathData, extToLoader: Map<string, Loader>, targetMapping: TargetMapping) {
        await this.ensureSchemaAliasInfoLoaded();

        let aliasInfo = this.schemaAliasInfoMap.get(getFileBaseName(source.path));
        let schemaFiles = await this.getSchemaFiles(source.path, targetMapping, aliasInfo);
        if (!schemaFiles) return;

        let promises = new Array<Promise<any>>();
        for (const schemaFile of schemaFiles) {
            let ext = path.extname(schemaFile);
            let loader = extToLoader.get(ext);
            if (loader) promises.push(loader.loadRawDataObject(schemaFile, this.config));
        }

        if (promises.length === 0) return;

        let configs = await Promise.all(promises);
        let finalConfig = merge.recursive(true, ...configs) as ISchemaConfigWithAlias;

        if (!finalConfig.type) {
            finalConfig.type = EXTENSION_TO_SCHEMA_TYPE.get(getFileExtension(source.path))!;
        }

        if (aliasInfo) {
            finalConfig = this.applyAliasInfo(finalConfig, schemaFiles, source.path, aliasInfo);
        }

        let newSchema = Schema.create(finalConfig.type);
        assertWithLoc(newSchema, `create-schema-failed"`, { source: source.path, schemaFile: schemaFiles });

        newSchema.config = finalConfig;
        newSchema.source = source;
        newSchema.schemaFiles = schemaFiles!.filter((v) => v !== undefined);

        await newSchema.generateFields();
        return newSchema;
    }

    // eslint-disable-next-line @typescript-eslint/member-ordering
    protected getTargetMappingConfig(): ITargetMappingConfig | undefined {
        return this.getConfig<IConfig>().targetMapping;
    }

    private async ensureSchemaAliasInfoLoaded() {
        if (!this.schemaAliasInfoPromise) {
            this.schemaAliasInfoPromise = (async () => {
                let aliasFile = this.getConfig<IConfig>().schemaAliasFile;
                if (!aliasFile || !(await pathExists(aliasFile))) return;

                let loader = Loader.create(".yml");
                assertWithLoc(loader, "invalid-loader", { phase: "GenerateSchema", ext: ".yml" });

                let aliasConfig = await loader.loadRawDataObject<ISchemaAliasFileConfig>(aliasFile, this.config);
                let aliases = aliasConfig.aliases ?? [];
                for (let alias of aliases) {
                    assertWithLoc(alias.sourceBaseName, "schema-alias-invalid-source-base-name", {
                        file: aliasFile,
                    });
                    assertWithLoc(alias.schemaBaseName, "schema-alias-invalid-schema-base-name", {
                        file: aliasFile,
                        sourceBaseName: alias.sourceBaseName,
                    });

                    let found = this.schemaAliasInfoMap.get(alias.sourceBaseName);
                    assertWithLoc(!found, "schema-alias-duplicate-source-base-name", {
                        file: aliasFile,
                        sourceBaseName: alias.sourceBaseName,
                    });

                    this.schemaAliasInfoMap.set(alias.sourceBaseName, alias);
                }
            })();
        }

        await this.schemaAliasInfoPromise;
    }

    private async getSchemaFiles(sourcePath: string, targetMapping: TargetMapping, aliasInfo?: ISchemaAliasInfo) {
        if (!aliasInfo) return await targetMapping.getTargets(sourcePath);

        let aliasedSource = path.join(path.dirname(sourcePath), aliasInfo.schemaBaseName + path.extname(sourcePath));
        let schemaFiles = await targetMapping.getTargets(aliasedSource);
        assertWithLoc(schemaFiles && schemaFiles.length > 0, "schema-alias-schema-file-not-found", {
            source: sourcePath,
            schemaBaseName: aliasInfo.schemaBaseName,
        });

        return schemaFiles;
    }

    private applyAliasInfo(finalConfig: ISchemaConfigWithAlias, schemaFiles: string[], sourcePath: string, aliasInfo: ISchemaAliasInfo) {
        let newConfig = deepCopy(finalConfig) as ISchemaConfigWithAlias;
        let originalName = newConfig.name;
        let aliasBaseName = aliasInfo.sourceBaseName || getFileBaseName(sourcePath);
        let preferredPostProcessName = aliasInfo.nameOverride?.trim();
        let disableDataPostProcess = aliasInfo.disableDataPostProcess === true;

        newConfig.name = !disableDataPostProcess && preferredPostProcessName ? preferredPostProcessName : `${originalName}_${aliasBaseName}`;
        newConfig.exportToTS = false;
        newConfig.outputMappingSource = path.join(path.dirname(schemaFiles[0]), aliasBaseName + path.extname(schemaFiles[0]));

        if (disableDataPostProcess) {
            newConfig.useSchemaConfigNameAsKey = false;
            delete newConfig.additionalDataPostProcess;
            delete newConfig.additionalDataPostProcessList;
            return newConfig;
        }

        if (preferredPostProcessName) {
            newConfig.useSchemaConfigNameAsKey = true;
        }

        if (!preferredPostProcessName || !DataPostProcess.hasRegisteredDataPostProcess(preferredPostProcessName)) {
            this.appendFallbackPostProcess(newConfig, originalName);
        }

        return newConfig;
    }

    private appendFallbackPostProcess(config: ISchemaConfigWithAlias, key: string) {
        if (config.additionalDataPostProcessList) {
            if (!config.additionalDataPostProcessList.find((item) => item.key === key)) {
                config.additionalDataPostProcessList.push({ key });
            }
            return;
        }

        if (config.additionalDataPostProcess) {
            if (config.additionalDataPostProcess.key === key) return;
            config.additionalDataPostProcessList = [config.additionalDataPostProcess, { key }];
            delete config.additionalDataPostProcess;
            return;
        }

        config.additionalDataPostProcess = { key };
    }
}
GenerateSchema.register();
