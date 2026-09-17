import { LastProcessorOutputData } from "../data/Data";
import type { IProcessorConfig } from "./Base";
import { Processor } from "./Base";

interface IConfig extends IProcessorConfig {
    processors: IProcessorConfig[];
}

/**
 * 并发执行多个 processor，各自在相同的输入数据上独立运行，以 Promise.all 并发调度。
 * 返回第一个 processor 的输出（视为主输出）；其余 processor 的副作用（如 addExtraData）
 * 已作用于共享的输入对象上。适用于彼此独立、写不同目录的 processor（如 SerializeToJson + SerializeToLua）。
 */
class ConcurrentProcessors extends Processor<ConcurrentProcessors> {
    public inputDataType = LastProcessorOutputData;
    public outputDataType = LastProcessorOutputData;

    private subProcessors: Processor<any>[] = [];

    public onCreate() {
        const config = this.getConfig<IConfig>();
        for (const pConfig of config.processors) {
            const p = Processor.create(pConfig.type);
            if (!p) throw new Error(`ConcurrentProcessors: failed to create processor "${pConfig.type}"`);
            p.config = pConfig;
            p.onCreate();
            this.subProcessors.push(p);
        }
    }

    public async processAll(allData: Array<any>): Promise<any[]> {
        try {
            // 给每个 sub-processor 传浅拷贝的数组（底层对象共享，mutations 互相可见）
            const results = await Promise.all(
                this.subProcessors.map(p => p.processAll([...allData]))
            );

            const failed = this.subProcessors.find(p => p.hasErrorOccurred());
            if (failed) {
                this.setFailed(new Error(failed.getLastError() ?? "unknown"));
                return [];
            }

            return results[0] ?? allData;
        } catch (e: any) {
            this.setFailed(e);
            return [];
        }
    }

    protected processSingle(data: any) {
        return data;
    }
}
ConcurrentProcessors.register();
