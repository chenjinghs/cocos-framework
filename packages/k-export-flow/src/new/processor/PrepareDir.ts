import { AnyType, LastProcessorOutputData } from "../data";
import { ExportLogger } from "../misc/ExportLogger";
import { Manager } from "../manager/Manager";
import { ensureDir, mkDir, pathExists, rmPath } from "../misc/Util";
import { Processor } from "./Base";

import type { IProcessorConfig } from "./Base";

interface IConfig extends IProcessorConfig {
    /** 全量构建时重建(删掉重建)、增量构建时仅确保存在的目录。只能放中间产物目录 */
    paths?: string[];
    /**
     * 永不重建、始终只确保存在的目录。
     * 资源目录(Cocos assets 下带受版本管理 .meta 的目录)必须走这里:重建会连带删掉 .meta,
     * 编辑器重新导入会生成新 uuid,已有引用全断。这类目录的陈旧产物由 PathOperation Mirror 清理。
     */
    ensurePaths?: string[];
}

class PrepareDir extends Processor<PrepareDir> {
    public inputDataType = AnyType;
    public outputDataType = LastProcessorOutputData;

    protected async onPreProcessAll(inputs: Array<AnyType>) {
        const { paths, ensurePaths } = this.getConfig<IConfig>();
        const incrementBuild = Manager.getInstance().getAdditionalArg("incrementBuild") === "true";

        for (const dirPath of paths ?? []) {
            if (incrementBuild) {
                ExportLogger.logVerbose(`PrepareDir ensure ${dirPath}`);
                await ensureDir(dirPath);
            } else {
                ExportLogger.logVerbose(`PrepareDir recreate ${dirPath}`);
                if (await pathExists(dirPath)) await rmPath(dirPath);
                await mkDir(dirPath);
            }
        }

        for (const dirPath of ensurePaths ?? []) {
            ExportLogger.logVerbose(`PrepareDir ensure(never recreate) ${dirPath}`);
            await ensureDir(dirPath);
        }

        ExportLogger.logVerbose(
            `PrepareDir: ${incrementBuild ? "ensured" : "recreated"} ${paths?.length ?? 0} dir(s), ensured ${ensurePaths?.length ?? 0} dir(s)`,
        );
        return inputs;
    }

    protected processSingle(data: AnyType) {
        return data;
    }
}
PrepareDir.register();
