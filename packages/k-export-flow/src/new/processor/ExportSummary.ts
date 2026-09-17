import { AnyType, LastProcessorOutputData } from "../data";
import { ExportLogger } from "../misc/ExportLogger";
import { ExportOutputChangeType, ExportRunStats } from "../misc/ExportRunStats";
import { Processor } from "./Base";

import type { IProcessorConfig } from "./Base";

interface IConfig extends IProcessorConfig {
    ignorePatterns?: string[];
}

class ExportSummary extends Processor<ExportSummary> {
    public inputDataType = AnyType;
    public outputDataType = LastProcessorOutputData;

    protected async onPreProcessAll(inputs: Array<AnyType>) {
        const config = this.getConfig<IConfig>();
        const ignorePatterns = config.ignorePatterns ?? [];
        const ignoreRegexes = ignorePatterns.flatMap((p) => {
            const m = p.match(/^\/(.+)\/([gimsuy]*)$/);
            return m ? [new RegExp(m[1], m[2])] : [];
        });
        const ignoreLiterals = new Set(ignorePatterns.filter((p) => !/^\/(.+)\/([gimsuy]*)$/.test(p)));

        const allChanges = ExportRunStats.getInstance().getChanges();
        const changes = allChanges.filter(
            (c) => !ignoreLiterals.has(c.path) && !ignoreRegexes.some((r) => r.test(c.path)),
        );

        const outputLines = ["=== Export Summary ==="];

        if (changes.length === 0) {
            outputLines.push("No output file changes");
            ExportLogger.logKey(outputLines.join("\n"));
            return inputs;
        }

        if (ExportLogger.isVerbose()) {
            const TAG: Record<ExportOutputChangeType, string> = {
                [ExportOutputChangeType.Added]: "[A]",
                [ExportOutputChangeType.Modified]: "[M]",
                [ExportOutputChangeType.Deleted]: "[D]",
            };
            for (const change of changes) {
                outputLines.push(`${TAG[change.changeType]} ${change.path}`);
            }
        } else {
            const counts: Record<ExportOutputChangeType, number> = {
                [ExportOutputChangeType.Added]: 0,
                [ExportOutputChangeType.Modified]: 0,
                [ExportOutputChangeType.Deleted]: 0,
            };
            for (const change of changes) counts[change.changeType]++;
            const parts: string[] = [];
            if (counts[ExportOutputChangeType.Added] > 0) parts.push(`Added: ${counts[ExportOutputChangeType.Added]}`);
            if (counts[ExportOutputChangeType.Modified] > 0) parts.push(`Modified: ${counts[ExportOutputChangeType.Modified]}`);
            if (counts[ExportOutputChangeType.Deleted] > 0) parts.push(`Deleted: ${counts[ExportOutputChangeType.Deleted]}`);
            outputLines.push(parts.join("  "));
        }

        ExportLogger.logKey(outputLines.join("\n"));
        return inputs;
    }

    protected processSingle(data: AnyType) {
        return data;
    }
}
ExportSummary.register();
