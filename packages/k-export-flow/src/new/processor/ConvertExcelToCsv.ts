import * as path from "path";
import { glob } from "glob";

import { AnyType, FilePathData } from "../data";
import { ExportLogger } from "../misc/ExportLogger";
import { Manager } from "../manager/Manager";
import { Processor } from "./Base";

import type { IProcessorConfig } from "./Base";
import type { IConvertParams } from "../misc/ExcelToCsv";
import { convertExcelToCsv } from "../misc/ExcelToCsv";

interface IConfig extends IProcessorConfig {
    sourceBaseDir: string;
    targetBaseDir: string;
    pattern: string;
    ignore?: string;
    clearTargetFiles?: boolean;
    incrementBuildInfoPath?: string;
    ignoreDataAfterEmptyLine?: boolean;
    outputLog?: boolean;
    sheetName?: string;
    replaceNameString?: string;
    concurrency?: number;
}

class ConvertExcelToCsv extends Processor<ConvertExcelToCsv> {
    public inputDataType = AnyType;
    public outputDataType = FilePathData;

    public async processAll(data: FilePathData[]) {
        let ret = await super.processAll(data);

        let config = this.getConfig<IConfig>();
        let sourceBaseDir = config.sourceBaseDir;
        let targetBaseDir = config.targetBaseDir;
        let pattern = config.pattern;
        let ignore = config.ignore;
        let incrementBuild = Manager.getInstance().getAdditionalArg("incrementBuild") === "true";
        let clearTargetFiles = config.clearTargetFiles ?? !incrementBuild;
        let incrementBuildInfoPath = config.incrementBuildInfoPath;
        let ignoreDataAfterEmptyLine = config.ignoreDataAfterEmptyLine ?? true;
        let outputLog = config.outputLog ?? false;
        let sheetName = config.sheetName;
        let replaceNameString = config.replaceNameString;
        let concurrency = config.concurrency;

        const resolvedSourceBaseDir = path.resolve(sourceBaseDir);
        let patterns = pattern.split(",").map((p) => p.trim());
        let ignorePatterns = ignore ? ignore.split(",").map((p) => p.trim()) : [];

        if (outputLog) ExportLogger.logKey("ConvertExcelToCsv: preparing Excel conversion, please wait...");

        // 根据目标语言自动生成本地化目录过滤规则，无需在 YAML 中手动维护 language_pipe 变量
        const language = Manager.getInstance().getAdditionalArg("language");
        const languages = language?.split(",").map((l) => l.trim()).filter(Boolean) ?? [];
        if (languages.length > 0) {
            const languagePipe = languages.join("|");
            ignorePatterns.push(`localization/!(ZH_CN|${languagePipe})/**`);
        }

        let sourceFiles = await glob(patterns, {
            cwd: resolvedSourceBaseDir,
            nodir: true,
            ignore: ignorePatterns,
            absolute: true,
        });

        let replaceNameStringArr = replaceNameString ? replaceNameString.split(";").map((p) => p.split(":")) : [];
        let convertedCount = 0;
        let deletedCount = 0;
        let logger = (message: string) => {
            if (message.startsWith("verbose: ")) {
                ExportLogger.logVerbose(message.slice("verbose: ".length));
            } else if (message.startsWith("convert ")) {
                ++convertedCount;
                ExportLogger.logVerbose(message);
            } else if (message.startsWith("delete ")) {
                ++deletedCount;
                ExportLogger.logVerbose(message);
            } else {
                ExportLogger.logKey(message);
            }
        };

        let params: IConvertParams = {
            sourceBaseDir: resolvedSourceBaseDir,
            targetBaseDir,
            sourceFiles,
            clearTargetFiles,
            incrementBuild,
            incrementBuildInfoPath,
            replaceNameString: replaceNameStringArr,
            outputLog,
            needIgnoreDataAfterEmptyLine: ignoreDataAfterEmptyLine,
            sheetName,
            ignore: ignorePatterns,
            logger,
            concurrency,
        };

        let result = await convertExcelToCsv(params);

        // 保存增量缓存信息到 Manager，由 exportOnceImp 在导出成功后统一写入
        if (result.incrementBuildInfo && result.incrementBuildInfoPath) {
            Manager.getInstance().setPendingIncrementBuildInfo(result.incrementBuildInfo, result.incrementBuildInfoPath);
        }

        return ret;
    }

    public async processSingle(data: FilePathData) {
        return data;
    }

    protected canRunInMultiThread(): boolean {
        return false;
    }
}
ConvertExcelToCsv.register();
