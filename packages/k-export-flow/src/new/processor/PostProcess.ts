import * as fs from "fs";
import * as path from "path";
import { DataWithSchema, JsonFileExtraData } from "../data";
import { ExportLogger } from "../misc/ExportLogger";
import { Manager } from "../manager/Manager";
import { newLocError } from "../misc/Localization";
import { Processor } from "./Base";
import { PostProcessDependencyRegistry } from "./PostProcessDependencyRegistry";

import type { IProcessorConfig } from "./Base";
export type PostProcessSingleFunc = ((output: DataWithSchema, config?: any) => Promise<void>) | ((output: DataWithSchema, config?: any) => void);
export type PostProcessAllFunc = ((output: DataWithSchema[]) => Promise<void>) | ((output: DataWithSchema[]) => void);

export const DEFAULT_POST_PROCESS_PRIORITY = 0;

export interface IAdditionalDataProcessConfig {
    key: string;
    config?: unknown;
}

export interface IDataPostProcessConfig extends IProcessorConfig {
    useSchemaConfigNameAsKey?: boolean; // default true
    additionalDataPostProcess?: IAdditionalDataProcessConfig;
    additionalDataPostProcessList?: IAdditionalDataProcessConfig[];
}


export class DataPostProcess {
    private static dependencyRegistry: PostProcessDependencyRegistry | null = null;
    // 暂存 registerAllDataPostProcess 的 callerFile 信息，供 injectDependencyRegistry 后同步到 registry
    private static pendingProcessorFiles = new Map<string, string>();
    // 暂存 registerDataPostProcess（单表）的 callerFile 信息，处理同 pendingProcessorFiles
    private static pendingSingleTableFiles = new Map<string, string>();

    public static setDependencyRegistry(registry: PostProcessDependencyRegistry) {
        DataPostProcess.dependencyRegistry = registry;
    }

    public static getDependencyRegistry(): PostProcessDependencyRegistry | null {
        return DataPostProcess.dependencyRegistry;
    }

    public static registerDataPostProcess(key: string, func: PostProcessSingleFunc) {
        // 单表后处理器：捕获注册它的 TS 源文件，纳入增量哈希检测（与 registerAllDataPostProcess 对齐）。
        // 单表 processor 的 key 即表名，依赖表就是自身，故只需把 file→key 映射进 registry 即可。
        const callerFile = DataPostProcess.captureCallerFile();
        if (callerFile) {
            if (DataPostProcess.dependencyRegistry) {
                DataPostProcess.dependencyRegistry.registerSingleTableProcessor(key, callerFile);
            } else {
                // dependencyRegistry 尚未初始化（模块加载时），暂存供 loadPendingProcessorFiles 同步
                DataPostProcess.pendingSingleTableFiles.set(key, callerFile);
            }
        }
        PostProcess.registerWithKey(key, func);
    }

    public static registerAllDataPostProcess(
        processorName: string,
        func: PostProcessAllFunc,
        order = DEFAULT_POST_PROCESS_PRIORITY,
    ) {
        const callerFile = DataPostProcess.captureCallerFile();
        if (DataPostProcess.dependencyRegistry) {
            DataPostProcess.dependencyRegistry.validateAndRegister(processorName, callerFile);
        } else {
            // dependencyRegistry 尚未初始化（模块加载时），暂存 callerFile 供后续同步
            DataPostProcess.pendingProcessorFiles.set(processorName, callerFile);
        }

        PostProcess.registerAllWithKey(func, order, processorName);
    }

    public static getPendingProcessorFiles(): Map<string, string> {
        return new Map(DataPostProcess.pendingProcessorFiles);
    }

    public static clearPendingProcessorFiles(): void {
        DataPostProcess.pendingProcessorFiles.clear();
    }

    public static getPendingSingleTableFiles(): Map<string, string> {
        return new Map(DataPostProcess.pendingSingleTableFiles);
    }

    public static clearPendingSingleTableFiles(): void {
        DataPostProcess.pendingSingleTableFiles.clear();
    }

    private static captureCallerFile(): string {
        const saved = Error.stackTraceLimit;
        Error.stackTraceLimit = 6;
        const lines = (new Error().stack ?? "").split("\n");
        Error.stackTraceLimit = saved;
        for (let i = 1; i < lines.length; i++) {
            const line = lines[i];
            if (/PostProcess\.(ts|js)|[/\\]Util\.(ts|js)/.test(line)) continue;

            // 1) 尝试匹配括号格式: (path:line:col)
            let m = line.match(/\((.+?):\d+:\d+\)/);
            if (!m) {
                // 2) 尝试匹配无括号格式: at [func ]path:line:col
                m = line.match(/at\s+(?:.+?\s+)?(.+?):\d+:\d+/);
            }
            if (m?.[1]) {
                let filePath = m[1].replaceAll("\\", "/");
                // Node.js 运行时加载的是编译后的 .js，将路径映射回源码 .ts
                filePath = filePath.replace(/\/dist\//g, "/src/").replace(/\.js$/, ".ts");
                return filePath;
            }
        }
        return "";
    }

    public static hasRegisteredDataPostProcess(key: string) {
        return PostProcess.hasRegisteredKey(key);
    }
}

interface IPostProcessAllFuncInfo {
    func: PostProcessAllFunc;
    order: number;
    name: string;
}

class PostProcess extends Processor<PostProcess> {
    private static keyToProcessor = new Map<string, PostProcessSingleFunc>();
    private static all = new Array<IPostProcessAllFuncInfo>();

    public static registerWithKey(key: string, func: PostProcessSingleFunc) {
        // assert(!this.keyToProcessor.has(key), `DataPostProcess register duplicated: ${key}`);
        if (this.keyToProcessor.has(key)) return;
        this.keyToProcessor.set(key, func);
    }

    public static registerAllWithKey(func: PostProcessAllFunc, order: number, name: string) {
        // assert(this.all.findIndex((v) => v.func === func) < 0, `DataPostProcess registerAll duplicated: ${func}`);
        if (this.all.findIndex((v) => v.func === func) >= 0) return;
        const entry = { func, order, name };
        const idx = this.all.findIndex((v) => v.order > order);
        if (idx === -1) this.all.push(entry);
        else this.all.splice(idx, 0, entry);
    }

    public static hasRegisteredKey(key: string) {
        return this.keyToProcessor.has(key);
    }

    public inputDataType = DataWithSchema;
    public outputDataType = DataWithSchema;

    public async processSingle(data: DataWithSchema) {
        let templateConfigs = this.getAdditionalPostProcessList(data);
        if (templateConfigs) {
            for (let templateConfig of templateConfigs) {
                await this.callFunc(templateConfig.key, data, templateConfig.config);
            }
        }
        if (this.useSchemaConfigNameAsKey()) {
            await this.callFunc(data.schema.config.name, data);
        }

        if (data.toBeDeleted) return undefined;
        else return data;
    }

    public async onPostProcessAll(outputs: Array<DataWithSchema>) {
        await this.callFuncAll(outputs);

        return outputs.filter((data) => !data.toBeDeleted);
    }

    private async callFunc(key: string | undefined, output: DataWithSchema, config?: unknown) {
        if (!key) return;

        let func = PostProcess.keyToProcessor.get(key);
        if (!func) return;

        try {
            let ret = func(output, config);
            if (ret instanceof Promise) await ret;
        } catch (err: any) {
            ExportLogger.logKey(`[POST_PROCESS] ${key} failed: ${err?.message ?? String(err)}`);
            ExportLogger.logVerbose(`[POST_PROCESS] ${key} stack: ${err?.stack ?? ""}`);

            // 删除此行已写出的输出文件，使下次增量能重新检测到变更
            for (const extra of output.extraData) {
                if (extra instanceof JsonFileExtraData && fs.existsSync(extra.targetPath)) {
                    try { fs.rmSync(extra.targetPath); } catch { /* ignore */ }
                }
            }
            // 从增量缓存中删除对应记录，使下次增量重新处理此文件
            const sourcePath = output.getSourcePath();
            if (sourcePath) {
                try {
                    const rootPath = Manager.getInstance().getAdditionalArg("rootPath") ?? "";
                    const cacheDir = path.join(rootPath, "TempSaved/export-flow");
                    const csvBaseName = path.basename(sourcePath, path.extname(sourcePath));

                    // 1. 从 export-csv-increment-info.json 中删除对应 xlsx 的 hash
                    const incrementInfoPath = path.join(cacheDir, "export-csv-increment-info.json");
                    if (fs.existsSync(incrementInfoPath)) {
                        const raw = JSON.parse(fs.readFileSync(incrementInfoPath, "utf-8"));
                        let removed = false;
                        for (const xlsxKey of Object.keys(raw)) {
                            if (path.basename(xlsxKey, ".xlsx") === csvBaseName) {
                                delete raw[xlsxKey];
                                removed = true;
                            }
                        }
                        if (removed) fs.writeFileSync(incrementInfoPath, JSON.stringify(raw), "utf-8");
                    }

                    // 2. 从 early-filter / filter-changed / collect-changed-schema 缓存中删除对应 csv 记录
                    const dataCacheFiles = [
                        "early-filter-file-path-data-info.json",
                        "filter-changed-file-path-data-info.json",
                        "filter-changed-schema.json",
                    ];
                    for (const cacheFileName of dataCacheFiles) {
                        const cacheFilePath = path.join(cacheDir, cacheFileName);
                        if (!fs.existsSync(cacheFilePath)) continue;
                        try {
                            const cacheRaw = JSON.parse(fs.readFileSync(cacheFilePath, "utf-8"));
                            if (cacheRaw.data && Array.isArray(cacheRaw.data)) {
                                const beforeLen = cacheRaw.data.length;
                                cacheRaw.data = cacheRaw.data.filter((entry: any) => {
                                    const entryBaseName = path.basename(entry.path ?? "", path.extname(entry.path ?? ""));
                                    return entryBaseName !== csvBaseName;
                                });
                                if (cacheRaw.data.length < beforeLen) {
                                    fs.writeFileSync(cacheFilePath, JSON.stringify(cacheRaw), "utf-8");
                                }
                            }
                        } catch { /* ignore */ }
                    }
                } catch { /* ignore */ }
            }

            throw err;
        }
    }

    private async callFuncAll(outputs: Array<DataWithSchema>) {
        // 如果有单个 callFunc 报错，跳过 callFuncAll 回调，避免缓存写入覆盖已删除的条目
        if (this.hasErrorOccurred()) return;

        const allPostProcess = PostProcess.all;

        const registry = DataPostProcess.getDependencyRegistry();

        for (let data of allPostProcess) {
            if (registry) {
                const regexes = registry.getProcessorCsvGroupRegexes(data.name);
                const readsTables = registry.getProcessorTables(data.name);

                const hasCsvCondition = regexes !== undefined && regexes.length > 0;
                const hasTableCondition = readsTables !== undefined && readsTables.length > 0;

                // csvGroups 和 readsTables 是 OR 关系：任一匹配即执行，两者均不匹配才跳过
                if (hasCsvCondition || hasTableCondition) {
                    const outputNames = new Set(outputs.map((o) => o.schema.config.name));
                    const csvMatches = hasCsvCondition && outputs.some((o) => regexes!.some((r) => r.test(o.getSourcePath())));
                    const tableMatches = hasTableCondition && readsTables!.some((t) => outputNames.has(t));

                    if (!csvMatches && !tableMatches) {
                        ExportLogger.logVerbose(`[POST_PROCESS] ${data.name} skipped (no matching csvGroups or readsTables in this build)`);
                        continue;
                    }
                }
            }

            const startTime = Date.now();
            try {
                let ret = data.func(outputs);
                if (ret instanceof Promise) await ret;
            } catch (err: any) {
                this.setErrorOccurred(err);
                ExportLogger.logKey(`[POST_PROCESS] ${data.name} failed: ${err?.message ?? String(err)}`);
                ExportLogger.logVerbose(`[POST_PROCESS] ${data.name} stack: ${err?.stack ?? ""}`);
                throw err;
            } finally {
                const elapsed = (Date.now() - startTime) / 1000;
                if (elapsed > 0.01) {
                    ExportLogger.logVerbose(`post-process handler ${data.name}, time: ${elapsed} s`);
                }
            }
        }
    }

    private useSchemaConfigNameAsKey() {
        let config = this.getConfig<IDataPostProcessConfig>();
        return config.useSchemaConfigNameAsKey === undefined || config.useSchemaConfigNameAsKey;
    }

    private getAdditionalPostProcessList(data: DataWithSchema) {
        let config = data.schema.config as unknown as IDataPostProcessConfig;
        return config.additionalDataPostProcess ? [config.additionalDataPostProcess] : config.additionalDataPostProcessList;
    }
}
PostProcess.register();
