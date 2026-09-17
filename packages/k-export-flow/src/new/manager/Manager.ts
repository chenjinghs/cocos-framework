/* eslint-disable @typescript-eslint/member-ordering */
import * as fs from "fs";
import * as merge from "merge";
// import WorkerPool from "./WorkerPool";
import * as path from "path";
import * as yaml from "yaml";

import { RootConfigSchema } from "../schema/config-schema";
import type { CacheEntry } from "../misc/ExcelToCsv";
import { AnyType, LastProcessorInputData, LastProcessorOutputData } from "../data/Data";
import { createDefaultGlobalConfig, getGlobalConfig, setGlobalConfig } from "../data/Define";
import { ExportLogger, ExportRunStats } from "../misc";
import { assertWithLoc, formatLoc, parseLocalizationConfig } from "../misc/Localization";
import { Registry } from "../misc/Registry";
import { assert } from "../misc/Util";
import { Processor } from "../processor/Base";
import { PostProcessDependencyRegistry } from "../processor/PostProcessDependencyRegistry";
import { CollectChangedSchema } from "../processor/CollectChangedSchema";
import { DataPostProcess } from "../processor/PostProcess";

import type { DataType, IData, IGlobalConfig } from "../data/Define";
import type { IProcessorConfig } from "../processor/Base";
// 多线程机制和想象中的不太一样，暂时先不用了，回头再看看
const USE_WORKER_POOL = false;

type ProcessorOutputType = IData | Array<IData> | undefined;
export interface IPipelineConfig extends IGlobalConfig {
    processors: IProcessorConfig[];
}

interface IConfig extends IPipelineConfig {}

export class Pipeline {
    public processors = new Array<Processor<any>>();
    public config: IPipelineConfig;

    public constructor(config: IPipelineConfig) {
        this.config = config;
    }
}

export class Manager {
    private static instance?: Manager;
    public static getInstance() {
        if (!this.instance) this.instance = new Manager();
        return this.instance;
    }

    public static async destroy() {
        if (this.instance) {
            // Wait for all processing data to finish and processors to complete
            const instance = this.instance;
            const maxWaitMs = 10000;
            const pollIntervalMs = 50;
            let waited = 0;

            while (waited < maxWaitMs) {
                let allDone = instance.processingData.size === 0;

                if (allDone && instance.currentPipeline) {
                    for (const p of instance.currentPipeline.processors) {
                        if (p.isRunning()) {
                            allDone = false;
                            break;
                        }
                    }
                }

                if (allDone) break;

                await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
                waited += pollIntervalMs;
            }

            if (waited >= maxWaitMs) {
                console.warn(`Manager.destroy() timed out waiting for processors to finish (${waited}ms)`);
            }

            Registry.tryResetAll();
            this.instance = undefined;
        }
    }

    // private workerPool?: WorkerPool;
    private currentPipeline?: Pipeline;
    private processingData = new Set<symbol>();
    private rootConfig!: IConfig;
    private startTime = 0;
    private additionalArgs?: Map<string, string>;
    private currentProcessor?: Processor<any>;
    private finished = false;
    private lastError?: string;
    private pendingCacheWrites = new Map<string, () => Promise<void>>();

    // public constructor() {
    //     // if (USE_WORKER_POOL) this.workerPool = new WorkerPool(os.availableParallelism());
    // }

    public async run(configYaml: string, additionalArgs: Map<string, string>, throwError?: boolean) {
        this.finished = false;
        this.additionalArgs = additionalArgs;
        ExportLogger.setVerbose(this.getAdditionalArg("verbose"));
        ExportRunStats.resetInstance(this.getAdditionalArg("rootPath"));
        this.startTime = Date.now();
        const parsed = yaml.parse(fs.readFileSync(configYaml, "utf8"));
        const config = RootConfigSchema.parse(parsed) as unknown as IConfig;
        this.rootConfig = config;
        this.lastError = undefined;

        this.verifyGlobalConfig(config, config);
        parseLocalizationConfig(getGlobalConfig().localization);

        this.injectDependencyRegistry(additionalArgs);

        // Cycle detection — must run before any pipeline execution
        const registry = DataPostProcess.getDependencyRegistry();
        if (registry) {
            const cycles = registry.detectCycles();
            if (cycles.length > 0) {
                const cycleStr = cycles.map(c => c.join(" → ")).join("\n");
                throw new Error(`Circular dependency detected in post-process-deps.yml:\n${cycleStr}`);
            }
        }

        this.processEnvVars(config);

        this.currentPipeline = new Pipeline(config);
        this.createPipeline(config);

        if (config.processors.length === 0) throw new Error(`pipeline.yml has no processors`);

        return this.runProcessors(this.currentPipeline.processors)
            .catch((e) => {
                this.lastError = e?.message ?? String(e);
                ExportLogger.logVerbose(`Manager stack: ${e?.stack ?? ""}`);
                if (throwError !== false) throw e;
            })
            .finally(() => {
                this.finished = true;
            });
    }

    private createPipeline(config: IPipelineConfig) {
        assert(this.currentPipeline !== undefined, "current pipeline is undefined");
        this.replaceArgs(config, this.additionalArgs) as IPipelineConfig;

        let pipeline = this.currentPipeline;
        let processors = pipeline.processors;

        for (const processorConfig of config.processors) {
            if ((processorConfig as any).enabled === false) continue;

            let newProcessor = Processor.create(processorConfig.type);
            assertWithLoc(newProcessor, "create-processor-failed", { type: processorConfig.type });
            newProcessor.config = processorConfig;

            let lastProcessor = processors.length > 0 ? processors[processors.length - 1] : undefined;
            let srcDataTypes = lastProcessor ? lastProcessor.outputDataType : undefined;
            let destDataTypes = newProcessor.inputDataType;
            let matched = this.matchDataType(srcDataTypes, destDataTypes);
            assertWithLoc(matched, "processor-input-or-output-is-not-matched", {
                last: lastProcessor?.constructor.name,
                next: newProcessor.constructor.name,
            });

            processors.push(newProcessor);
            newProcessor.onCreate();
        }
        return pipeline;
    }

    public async runProcessors(processors: Array<Processor<any>>, startIndex?: number, startData?: Array<IData>) {
        let savedProcessor = this.currentProcessor;
        let data: Array<IData | undefined> | undefined = startData;
        let count = processors.length;
        let start = startIndex ?? 0;
        for (let i = start; i < count; ++i) {
            this.currentProcessor = processors[i];

            if (!data || data.length === 0) {
                // 如果没有至少给个空，为了能让processor至少有一个数据
                if (this.currentProcessor.inputDataType === undefined || this.currentProcessor.inputDataType === AnyType) data = new Array<IData | undefined>(undefined);
                else break; // 无数据直接打断处理
            }

            let handle = Symbol("processing-data");
            this.processingData.add(handle);

            let startTime = Date.now();
            try {
                data = await this.currentProcessor.processAll(data);
            } finally {
                this.processingData.delete(handle);
            }

            let time = (Date.now() - startTime) / 1000;
            ExportLogger.logVerbose(`run processor ${this.currentProcessor.constructor.name}, time: ${time} s`);

            if (this.currentProcessor.hasErrorOccurred()) {
                this.lastError = this.currentProcessor.getLastError();
                throw new Error(`processor ${this.currentProcessor.constructor.name} has error occurred: ${this.lastError}`);
            }
        }
        this.currentProcessor = undefined;

        for (let i = start; i < processors.length; ++i) {
            let processor = processors[i];
            if (processor.isRunning()) this.runProcessors(processors, i); // 这里特意不await
        }

        this.verifyAllFinished();
        data = data?.filter((v) => v !== undefined);
        this.currentProcessor = savedProcessor;
        return data as IData[] | undefined;
    }

    public getLastError() {
        return this.lastError;
    }

    // public runInWorker(func: () => ProcessorOutputType | Promise<ProcessorOutputType>) {
    //     if (USE_WORKER_POOL) {
    //         // return new Promise<ProcessorOutputType>((resolve) => {
    //         //     this.workerPool!.runTask(func, (newData: ProcessorOutputType) => {
    //         //         resolve(newData);
    //         //     });
    //         // });
    //         assert(false, "not support worker pool");
    //     } else {
    //         return new Promise<ProcessorOutputType>((resolve, reject) => {
    //             resolve(func());
    //         });
    //     }
    // }

    public getCurrentProcessor() {
        return this.currentProcessor;
    }

    public findProcessor(type: string) {
        return this.currentPipeline?.processors.find((v) => v.config.type === type);
    }

    public hasFinished() {
        return this.finished;
    }

    public getAdditionalArg(key: string) {
        return this.additionalArgs?.get(key);
    }

    public setPendingCacheWrite(key: string, writer: () => Promise<void>): void {
        this.pendingCacheWrites.delete(key);
        this.pendingCacheWrites.set(key, writer);
    }

    public async flushPendingCacheWrites(): Promise<void> {
        const writers = Array.from(this.pendingCacheWrites.values());
        this.pendingCacheWrites.clear();
        let firstError: any;
        for (const writer of writers) {
            try {
                await writer();
            } catch (e) {
                if (!firstError) firstError = e;
            }
        }
        if (firstError) throw firstError;
    }

    public setPendingIncrementBuildInfo(info: Map<string, CacheEntry>, infoPath: string): void {
        this.setPendingCacheWrite("export-csv-increment-info", async () => {
            const INCREMENT_BUILD_INFO_NAME = "export-csv-increment-info.json";
            const fullPath = path.join(infoPath, INCREMENT_BUILD_INFO_NAME);
            const jsonObject: Record<string, CacheEntry> = {};
            info.forEach((value, key) => {
                jsonObject[key] = value;
            });
            await fs.promises.writeFile(fullPath, JSON.stringify(jsonObject), "utf-8");
        });
    }

    public async flushPendingIncrementBuildInfo(): Promise<void> {
        return this.flushPendingCacheWrites();
    }

    private injectDependencyRegistry(additionalArgs: Map<string, string>) {
        const rootPath = additionalArgs.get("rootPath");
        if (!rootPath) return;

        const yamlPath = `${rootPath}/ExternalConfig/export-flow-setting/post-process-deps.yml`;
        if (!fs.existsSync(yamlPath)) return;

        const registry = new PostProcessDependencyRegistry();
        registry.loadYamlDeclarations(yamlPath);
        registry.loadPendingProcessorFiles();
        registry.loadAdditionalPostProcessReferences(`${rootPath}/ExternalConfig/export-flow-setting`);

        DataPostProcess.setDependencyRegistry(registry);
        CollectChangedSchema.setDependencyRegistry(registry);
    }

    private verifyGlobalConfig(config: IConfig, pConfig: IPipelineConfig) {
        let g = createDefaultGlobalConfig();
        merge.recursive(g, config, pConfig);
        setGlobalConfig(g);
    }

    private verifyAllFinished() {
        if (this.processingData.size > 0) return false;

        if (this.currentPipeline) {
            for (let p of this.currentPipeline.processors) {
                if (p.isRunning()) return false;
            }
        }

        // this.workerPool?.close();

        let time = (Date.now() - this.startTime) / 1000;
        ExportLogger.logKey(formatLoc(`pipeline-finished`, { time: time }));
        return true;
    }

    private processEnvVars(config: IConfig) {
        const env = (config as any).env as Array<Record<string, string>> | undefined;
        if (!env || !this.additionalArgs) return;
        for (const entry of env) {
            for (const [key, value] of Object.entries(entry)) {
                let resolved = value;
                for (const [k, v] of this.additionalArgs) {
                    resolved = resolved.replaceAll(`$${k}`, v);
                }
                this.additionalArgs.set(key, resolved);
            }
        }
    }

    private replaceArgs(o: any, commandArgs?: Map<string, string>) {
        if (!commandArgs) return o;

        const NEGATION = /(?<!\\)\$![\w-]+/g; // $!varName — boolean negation
        const REGULAR = /(?<!\\)\$[\w-]+/g;   // $varName — normal substitution
        for (let [k, v] of Object.entries(o)) {
            if (v === undefined || v === null) continue;

            if (typeof v === "string") {
                let target = v.trim();

                // Handle $!var negation first
                for (const m of target.match(NEGATION) ?? []) {
                    const arg = m.slice(2); // strip "$!"
                    const argValue = commandArgs.get(arg);
                    if (!argValue) continue;
                    const negated = argValue === "true" ? "false" : "true";
                    target = target.replace(m, negated);
                }

                // Normal $var substitution
                for (const m of target.match(REGULAR) ?? []) {
                    const arg = m.slice(1); // strip "$"
                    const argValue = commandArgs.get(arg);
                    if (!argValue) continue;
                    target = target.replace(m, argValue);
                }

                if (target === "true") o[k] = true;
                else if (target === "false") o[k] = false;
                else o[k] = target;
            } else if (typeof v === "object") {
                this.replaceArgs(v, commandArgs);
            }
        }
        return o;
    }

    private matchDataType(inSrc: DataType, inDest: DataType) {
        let src = this.verifyDataType(inSrc);
        let dest = this.verifyDataType(inDest);

        let ret;
        if (dest === AnyType) ret = true;
        else ret = this.isChildOf(src, dest);

        return ret;
    }

    private verifyDataType(dataType: DataType) {
        let ret = dataType;
        if (ret === LastProcessorInputData) ret = this.getLastInputDataType();
        else if (ret === LastProcessorOutputData) ret = this.getLastOutputDataType();
        return ret ?? AnyType;
    }

    private isChildOf(childCtor: any, parentCtor: any) {
        let ctor = childCtor;
        while (ctor.name.length !== 0) {
            if (ctor === parentCtor) {
                return true;
            }
            ctor = Object.getPrototypeOf(ctor);
        }
        return false;
    }

    private getLastInputDataType() {
        if (!this.currentPipeline) return AnyType;
        return this.getLastDataType(this.currentPipeline.processors.length - 1, true);
    }

    private getLastOutputDataType() {
        if (!this.currentPipeline) return AnyType;
        return this.getLastDataType(this.currentPipeline.processors.length - 1, false);
    }

    private getLastDataType(processorIndex: number, isInput: boolean): DataType {
        if (processorIndex < 0) return AnyType;

        let processor = this.currentPipeline!.processors[processorIndex];
        let dataType = isInput ? processor.inputDataType : processor.outputDataType;

        if (dataType === undefined) return AnyType;
        else if (dataType === LastProcessorOutputData) return this.getLastDataType(processorIndex - 1, false);
        else if (dataType === LastProcessorInputData) return this.getLastDataType(processorIndex - 1, true);
        else return dataType;
    }
}

// let u = Util as any;
// u.runInMultiThread = (funcInMultiThread: () => any) => {
//     return Manager.getInstance().runInWorker(funcInMultiThread);
// };
