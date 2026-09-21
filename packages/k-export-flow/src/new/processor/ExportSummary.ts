import { AnyType, LastProcessorOutputData } from "../data";
import { ExportRunStats } from "../misc/ExportRunStats";
import { Processor } from "./Base";

import type { IProcessorConfig } from "./Base";

interface IConfig extends IProcessorConfig {
    ignorePatterns?: string[];
}

class ExportSummary extends Processor<ExportSummary> {
    public inputDataType = AnyType;
    public outputDataType = LastProcessorOutputData;

    protected async onPreProcessAll(inputs: Array<AnyType>) {
        const ignorePatterns = this.getConfig<IConfig>().ignorePatterns ?? [];
        const ignoreRegexes = ignorePatterns.flatMap((p) => {
            const m = p.match(/^\/(.+)\/([gimsuy]*)$/);
            return m ? [new RegExp(m[1], m[2])] : [];
        });
        const ignoreLiterals = new Set(ignorePatterns.filter((p) => !/^\/(.+)\/([gimsuy]*)$/.test(p)));

        const stats = ExportRunStats.getInstance();
        stats.renderSummary(stats.getChanges().filter(
            (c) => !ignoreLiterals.has(c.path) && !ignoreRegexes.some((r) => r.test(c.path)),
        ));
        return inputs;
    }

    protected processSingle(data: AnyType) {
        return data;
    }
}
ExportSummary.register();
