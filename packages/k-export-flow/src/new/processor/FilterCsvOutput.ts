import * as fs from "fs";
import * as path from "path";

async function collectSubdirs(dir: string): Promise<string[]> {
    const result: string[] = [];
    try {
        const entries = await fs.promises.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isDirectory()) {
                const full = path.join(dir, entry.name);
                result.push(full);
                result.push(...(await collectSubdirs(full)));
            }
        }
    } catch { /* ignore */ }
    return result;
}

import { AnyType, LastProcessorOutputData } from "../data";
import { ExportLogger } from "../misc/ExportLogger";
import { ExportRunStats } from "../misc/ExportRunStats";
import { Manager } from "../manager/Manager";
import { pathExists, rmPath, walkParallelPromise } from "../misc/Util";
import { Processor } from "./Base";

import type { IProcessorConfig } from "./Base";

interface IConfig extends IProcessorConfig {
    csvDir: string;
    environmentRelativeFilePath?: string;
}

class FilterCsvOutput extends Processor<FilterCsvOutput> {
    public inputDataType = AnyType;
    public outputDataType = LastProcessorOutputData;

    protected async onPreProcessAll(inputs: Array<AnyType>) {
        const { csvDir, environmentRelativeFilePath } = this.getConfig<IConfig>();
        const language = Manager.getInstance().getAdditionalArg("language");
        const environment = Manager.getInstance().getAdditionalArg("environment") ?? "";
        const languages = language?.split(",").map((l) => l.trim()).filter(Boolean) ?? [];
        const keepLanguages = languages.length > 0 ? Array.from(new Set(["ZH_CN", ...languages])) : [];

        await this.deleteAllExceptInDir(path.join(csvDir, "localization"), keepLanguages);
        await this.overrideConfigWithEnv(csvDir, path.join(csvDir, "environment"), environment, environmentRelativeFilePath);

        return inputs;
    }

    protected processSingle(data: AnyType) {
        return data;
    }

    private async deleteAllExceptInDir(dir: string, excepts?: string | string[]) {
        if (!(await pathExists(dir))) return;

        excepts = typeof excepts === "string" ? excepts.split(",").map((e) => e.trim()).filter(Boolean) : (excepts ?? []);
        if (excepts.length === 0) return;

        const isExistsExcept = excepts.some((e) => fs.existsSync(path.join(dir, e)));
        if (!isExistsExcept) {
            ExportLogger.logVerbose(`No except[${excepts}] exist in ${dir}, skip delete all except operation.`);
            return;
        }

        ExportLogger.logVerbose(`delete all except in ${dir}, excepts: ${excepts}`);

        const toBeKept = excepts.map((e) => {
            let p = path.join(dir, e).replaceAll("\\", "/");
            if (!p.endsWith("/")) p += "/";
            return p;
        });

        const files = await walkParallelPromise(dir);
        for (const f of files) {
            const file = f.replaceAll("\\", "/");
            const needDelete = !toBeKept.some((kept) => file.startsWith(kept));
            if (needDelete) {
                this.recordDeleted(file);
                await rmPath(file);
            }
        }
    }

    private async overrideConfigWithEnv(dir: string, envDir: string, environment: string, environmentRelativeFilePath?: string) {
        if (!(await pathExists(dir))) return;

        ExportLogger.logVerbose(`[FilterCsvOutput] override config in ${dir} with env "${environment}" ...`);

        let targetEnvList: string[] = [environment];
        if (environmentRelativeFilePath) {
            if (!(await pathExists(environmentRelativeFilePath))) {
                ExportLogger.logKey(`[FilterCsvOutput] environment relative file not found: ${environmentRelativeFilePath}`);
                return;
            }
            const relativeEnvConfig = JSON.parse(await fs.promises.readFile(environmentRelativeFilePath, "utf-8"));
            if (relativeEnvConfig[environment]) targetEnvList.push(...relativeEnvConfig[environment]);
        }

        const normalize = (p: string) => p.replaceAll("\\", "/");
        const withSlash = (p: string) => (p.endsWith("/") ? p : `${p}/`);

        const normalizedDir = withSlash(normalize(dir));
        const targetEnvDirList = targetEnvList.map((env) => withSlash(normalize(path.join(envDir, env))));
        const sourceDirList = [...targetEnvDirList, normalizedDir];

        const getSourceDirIndex = (filePath: string) => sourceDirList.findIndex((sd) => filePath.startsWith(sd));

        // 删掉无关环境的配置文件
        const envFiles = (await pathExists(envDir)) ? (await walkParallelPromise(envDir)).map(normalize) : [];
        for (const file of envFiles) {
            if (targetEnvDirList.some((sd) => file.startsWith(sd))) continue;
            ExportLogger.logVerbose(`[FilterCsvOutput] remove unrelated env config: ${file}`);
            this.recordDeleted(file);
            await rmPath(file);
        }

        // 按优先级保留高优先级文件，删除低优先级同名文件
        const files = (await walkParallelPromise(dir))
            .map(normalize)
            .sort((a, b) => {
                const ai = getSourceDirIndex(a);
                const bi = getSourceDirIndex(b);
                return (ai >= 0 ? ai : Number.MAX_SAFE_INTEGER) - (bi >= 0 ? bi : Number.MAX_SAFE_INTEGER);
            });
        const keptFileNames = new Set<string>();
        for (const file of files) {
            if (getSourceDirIndex(file) < 0) continue;
            const name = path.basename(file);
            if (!keptFileNames.has(name)) {
                keptFileNames.add(name);
                continue;
            }
            ExportLogger.logVerbose(`[FilterCsvOutput] remove lower-priority config: ${file}`);
            this.recordDeleted(file);
            await rmPath(file);
        }

        // 删除空目录（按最深路径优先，确保子目录先删）
        const allDirs = (await collectSubdirs(dir)).sort((a, b) => b.length - a.length);
        for (const d of allDirs) {
            const nd = normalize(d);
            try {
                const filesInDir = await fs.promises.readdir(d);
                if (filesInDir.length === 0) {
                    ExportLogger.logVerbose(`[FilterCsvOutput] remove empty dir: ${nd}`);
                    this.recordDeleted(nd);
                    await rmPath(d);
                }
            } catch { /* dir may already be removed */ }
        }
    }

    private recordDeleted(targetPath: string) {
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) ExportRunStats.getInstance().recordDeleted(targetPath);
    }
}
FilterCsvOutput.register();
