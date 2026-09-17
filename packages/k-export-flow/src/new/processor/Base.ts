import * as os from "os";

import type { InstanceDataType } from "../data/Data";
import type { Constructor, DataType, IData } from "../data/Define";
import { pushElementOrArray } from "../manager/Util";
import { ExportLogger } from "../misc/ExportLogger";
import { Registry } from "../misc/Registry";
import { TargetMapping } from "../misc/TargetMapping";
import type { ITargetMappingConfig } from "../misc/TargetMapping";
/* eslint-disable @typescript-eslint/member-ordering */
import { assert } from "../misc/Util";

const pLimit = require("p-limit");

const DEFAULT_CONCURRENCY_FALLBACK = 4;
const DEFAULT_CONCURRENCY_MAX = 32;

export function getAvailableParallelism(): number {
    return typeof (os as any).availableParallelism === "function"
        ? (os as any).availableParallelism() as number
        : os.cpus().length;
}

export function getDefaultConcurrency(): number {
    const envRaw = process.env.EXPORT_FLOW_CONCURRENCY;
    if (envRaw !== undefined && envRaw.trim() !== "") {
        const parsed = Number(envRaw);
        if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 1) {
            return Math.min(DEFAULT_CONCURRENCY_MAX, parsed);
        }
        ExportLogger.logKey(`[export-flow] WARNING: invalid EXPORT_FLOW_CONCURRENCY="${envRaw}", falling back to CPU-based default.`);
    }
    const cpuCount = os.cpus()?.length ?? DEFAULT_CONCURRENCY_FALLBACK;
    return Math.min(DEFAULT_CONCURRENCY_MAX, Math.max(DEFAULT_CONCURRENCY_FALLBACK, cpuCount));
}

export type TraitInputDataType<T extends { inputDataType: Constructor<IData> | undefined }> = InstanceDataType<T["inputDataType"]> | undefined;
export type TraitOutputDataType<T extends { outputDataType: Constructor<IData> | undefined }> = InstanceDataType<T["outputDataType"]> | undefined;
export type OutputDataType<T extends Processor<any>> = TraitOutputDataType<T> | Promise<TraitOutputDataType<T>> | Array<TraitOutputDataType<T>> | Promise<Array<TraitOutputDataType<T>>>;

export interface IProcessorConfig {
    type: string;
    description: string;
    [key: string]: unknown;
}

export enum EPostProcessPriority {
    // 优先级越低，越先执行
    Early = 0,
    Normal = 1000,
    Late = 2000,
}

export type PostProcessFunc = (allData: Array<IData>) => Promise<void> | void;
export class PostProcessFuncInfo {
    public constructor(public func: PostProcessFunc, public priority: number) {}
}

export class ProcessorContext {
    public postProcessFuncs = new Array<PostProcessFuncInfo>();
}

export abstract class Processor<T extends Processor<any>> {
    public static register<T extends Processor<any>>(this: Constructor<T>) {
        Registry.get(Processor).register(this);
    }
    public static create(key: string) {
        return Registry.get(Processor).create<Processor<any>>(key);
    }

    public abstract inputDataType: DataType;
    public abstract outputDataType: DataType;

    protected abstract processSingle(data: TraitInputDataType<T>): OutputDataType<T>;
    protected canRunInMultiThread(): boolean {
        return false;
    }

    public config!: IProcessorConfig;
    public context = new ProcessorContext();

    protected targetMapping?: TargetMapping;
    protected lastError?: string;

    public onCreate() {}

    public async processAll(allData: Array<TraitInputDataType<T>>) {
        try {
            await this.verifyTargetMapping();
            let inputs = await this.onPreProcessAll(allData);

            let outputs = new Array<TraitOutputDataType<T>>();
            let outputPS = new Array<Promise<any>>();

            if (this.canRunInMultiThread()) {
                const limit = pLimit(getDefaultConcurrency());
                for (let data of inputs) {
                    outputPS.push(
                        limit(async () => {
                            await this.processSingleWithTryCatch(data, outputs);
                        })
                    );
                }
            } else {
                for (let data of inputs) {
                    let r = this.processSingleWithTryCatch(data, outputs);
                    outputPS.push(r);
                }
            }

            if (outputPS.length > 0) {
                await Promise.all(outputPS);
            }

            let ret;
            for (let info of this.context.postProcessFuncs) {
                ret = info.func(outputs as IData[]);
                if (ret instanceof Promise) await ret;
            }

            outputs = await this.onPostProcessAll(outputs);
            return outputs;
        } catch (e: any) {
            this.lastError = e?.message ?? String(e);
            ExportLogger.logVerbose(`ERROR: processor ${this.config.type} has error occurred: ${e?.stack ?? String(e)}`);
            return [];
        }
    }

    public isRunning() {
        return false;
    }

    public hasErrorOccurred() {
        return !!this.lastError;
    }

    public setErrorOccurred(error: unknown) {
        this.lastError = error instanceof Error ? error.message : String(error ?? "unknown error");
    }

    public setFailed(error: unknown) {
        this.setErrorOccurred(error);
    }

    public getLastError() {
        return this.lastError;
    }

    public getConfig<T = IProcessorConfig>() {
        return this.config as T;
    }

    public addPostProcessFunc(func: PostProcessFunc, priority: number = EPostProcessPriority.Normal) {
        let newInfo = new PostProcessFuncInfo(func, priority);
        let infos = this.context.postProcessFuncs;
        for (let i = 0; i < infos.length; ++i) {
            if (infos[i].priority > priority) {
                infos.splice(i, 0, newInfo);
                return;
            }
        }
        this.context.postProcessFuncs.push(newInfo);
    }

    public removePostProcessFunc(func: PostProcessFunc) {
        let index = this.context.postProcessFuncs.findIndex((v) => v.func === func);
        if (index >= 0) this.context.postProcessFuncs.splice(index, 1);
    }

    public hasPostProcessFunc(func: PostProcessFunc) {
        return this.context.postProcessFuncs.findIndex((v) => v.func === func) >= 0;
    }

    protected getTargetMappingConfig(): ITargetMappingConfig | undefined {
        return undefined;
    }

    protected async verifyTargetMapping() {
        let config = this.getTargetMappingConfig();
        if (!config) return;

        this.targetMapping = await TargetMapping.create(config);
        assert(this.targetMapping, `invalid target mapping config ${config.name}`);
    }

    protected async processSingleWithTryCatch(data: TraitInputDataType<T>, outputs: Array<TraitOutputDataType<T>>) {
        try {
            let r = this.processSingle(data);

            if (r && r instanceof Promise) r = await r;
            if (r) pushElementOrArray(outputs, r);
        } catch (error: any) {
            this.lastError = error?.message ?? String(error);
            ExportLogger.logVerbose(`processSingle stack: ${error?.stack ?? ""}`);
        }
    }

    protected async onPreProcessAll(inputs: Array<TraitInputDataType<T>>) {
        return inputs;
    }

    protected async onPostProcessAll(outputs: Array<TraitOutputDataType<T>>) {
        return outputs;
    }
}

// ////////////////////////////////////////////////////////////////////////////////
