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
import { assertWithLoc } from "../misc/Localization";
import { copyDir, copyFile, ensureDir, ensureFile, getErrorInfo, mkDir, pathExists, rmPath, walkParallelPromise, writeFile } from "../misc/Util";
import { Processor } from "./Base";

import type { IProcessorConfig } from "./Base";
enum OperationType {
    Delete = "Delete",
    Recreate = "Recreate",
    Ensure = "Ensure",
    Copy = "Copy",
    DeleteAllExceptInDir = "DeleteAllExceptInDir",
    OverrideConfigWithEnv = "OverrideConfigWithEnv",
}

interface IOperation {
    type: OperationType;
}

interface IDefaultOperation extends IOperation {
    path: string;
    isFile?: boolean;
}

interface ICopyOperation extends IOperation {
    from: string;
    to: string;
    isFile?: boolean;
}

interface IDeleteAllExceptInDirOperation extends IOperation {
    dir: string;
    except: string;
    excepts: string[];
}

// 这个逻辑写着不合理，先这样凑合用着吧，不然改动太大了
interface IOverrideConfigWithEnvOperation extends IOperation {
    configDir: string;
    envConfigDir: string;
    environment: string;
    environmentRelativeFilePath?: string; // 可选项，如果提供了这个文件路径，则从这个文件中读取环境与其对应的envConfigDir下的文件的关系，来决定哪些文件需要被删除
}

interface IConfig extends IProcessorConfig {
    operations: Array<IOperation>;
}

class PathOperation extends Processor<PathOperation> {
    public inputDataType = AnyType;
    public outputDataType = LastProcessorOutputData;

    protected async onPreProcessAll(inputs: Array<AnyType>) {
        let config = this.getConfig<IConfig>();
        let operationCountMap = new Map<OperationType, number>();
        for (let o of config.operations) {
            let op = o as any;
            try {
                switch (op.type) {
                    case OperationType.Delete:
                        await this.deletePath(op.path, op.isFile);
                        break;
                    case OperationType.Recreate:
                        await this.deletePath(op.path, op.isFile);
                        await this.createPath(op.path, op.isFile);
                        break;
                    case OperationType.Ensure:
                        await this.ensurePath(op.path, op.isFile);
                        break;
                    case OperationType.Copy:
                        await this.copyPath(op.from, op.to, op.isFile);
                        break;
                    case OperationType.DeleteAllExceptInDir:
                        await this.deleteAllExceptInDir(op.dir, op.except ?? op.excepts);
                        break;
                    case OperationType.OverrideConfigWithEnv:
                        await this.overrideConfigWithEnv(op.configDir, op.envConfigDir, op.environment, op.environmentRelativeFilePath);
                        break;
                    default:
                        throw new Error(`invalid-operation-type ${op.type}`);
                }
                operationCountMap.set(op.type, (operationCountMap.get(op.type) ?? 0) + 1);
            } catch (error: any) {
                assertWithLoc(false, "path-operation-failed", { path: op.path, error: getErrorInfo(error) });
            }
        }
        if (operationCountMap.size > 0) {
            let summary = Array.from(operationCountMap.entries()).map(([type, count]) => `${type}: ${count}`).join(", ");
            ExportLogger.logVerbose(`PathOperation summary: ${summary}`);
        }
        return inputs;
    }

    protected async processSingle(data: AnyType) {
        return data;
    }

    // protected async deletePaths(paths: string | string[], isFile?: boolean) {
    //     if (typeof paths === "string") await this.deletePath(paths, isFile);
    //     else {
    //         let promises = new Array<Promise<void>>();
    //         for (let p of paths) {
    //             promises.push(this.deletePath(p, isFile));
    //         }
    //         await Promise.all(promises);
    //     }
    // }

    protected async deletePath(path: string, isFile?: boolean) {
        ExportLogger.logVerbose(`delete ${path}, isFile: ${!!isFile}`);
        if (!(await pathExists(path))) return;

        this.recordDeleted(path);
        await rmPath(path);
    }

    // protected async createPaths(paths: string | string[], isFile?: boolean) {
    //     if (typeof paths === "string") await this.createPath(paths, isFile);
    //     else {
    //         let promises = new Array<Promise<void>>();
    //         for (let p of paths) {
    //             promises.push(this.createPath(p, isFile));
    //         }
    //         await Promise.all(promises);
    //     }
    // }

    protected async createPath(path: string, isFile?: boolean) {
        ExportLogger.logVerbose(`create ${path}, isFile: ${!!isFile}`);
        if (isFile) await writeFile(path, "");
        else await mkDir(path);
    }

    // protected async ensurePaths(paths: string | string[], isFile?: boolean) {
    //     if (typeof paths === "string") await this.ensurePath(paths, isFile);
    //     else {
    //         let promises = new Array<Promise<void>>();
    //         for (let p of paths) {
    //             promises.push(this.ensurePath(p, isFile));
    //         }
    //         await Promise.all(promises);
    //     }
    // }

    protected async ensurePath(path: string, isFile?: boolean) {
        ExportLogger.logVerbose(`ensure ${path}, isFile: ${!!isFile}`);
        if (isFile) await ensureFile(path);
        else await ensureDir(path);
    }

    protected async copyPath(from: string, to: string, isFile?: boolean) {
        ExportLogger.logVerbose(`copy ${from} to ${to}, isFile: ${!!isFile}`);
        if (isFile) {
            this.recordCopiedFileChange(from, to);
            await copyFile(from, to);
        } else {
            await this.recordCopiedDirChange(from, to);
            await copyDir(from, to);
        }
    }

    protected async deleteAllExceptInDir(dir: string, excepts?: string | string[]) {
        if (!(await pathExists(dir))) return;

        excepts = typeof excepts === "string" ? excepts.split(",") : (excepts ?? []);

        let isExistsExcept = excepts?.some((e) => fs.existsSync(path.join(dir, e)));
        if (!isExistsExcept) {
            ExportLogger.logVerbose(`No except[${excepts}] exist in ${dir}, skip delete all except operation.`);
            return;
        }

        ExportLogger.logVerbose(`delete all except in ${dir}, excepts: ${excepts}`);

        let toBeDeleted = excepts ? (typeof excepts === "string" ? [excepts] : excepts) : [];
        for (let i = 0; i < toBeDeleted.length; i++) {
            toBeDeleted[i] = path.join(dir, toBeDeleted[i]).replaceAll("\\", "/");
            if (!toBeDeleted[i].endsWith("/")) toBeDeleted[i] += "/";
        }

        let files = await walkParallelPromise(dir);
        for (let f of files) {
            let file = f.replaceAll("\\", "/");
            let needDelete = true;

            for (let toBeD of toBeDeleted) {
                if (file.startsWith(toBeD)) {
                    needDelete = false;
                    break;
                }
            }

            if (needDelete) {
                this.recordDeleted(file);
                await rmPath(file);
            }
        }
    }

    protected async overrideConfigWithEnv(dir: string, envDir: string, environment: string, environmentRelativeFilePath?: string) {
        if (!(await pathExists(dir))) return;

        ExportLogger.logVerbose(`[OverrideConfigWithEnv] override config in ${dir} with env config in ${envDir} for environment ${environment} ...`);

        let targetEnvList: string[] = [environment];
        if (environmentRelativeFilePath) {
            if (!(await pathExists(environmentRelativeFilePath))) {
                ExportLogger.logKey(`[OverrideConfigWithEnv] environment relative file path does not exist: ${environmentRelativeFilePath}`);
                return;
            }
            let relativeEnvConfig = await JSON.parse(await fs.promises.readFile(environmentRelativeFilePath, "utf-8"));
            if (relativeEnvConfig[environment]) {
                targetEnvList.push(...relativeEnvConfig[environment]);
            }
        }

        function normalizePath(inputPath: string): string {
            return inputPath.replaceAll("\\", "/");
        }

        function ensureTrailingSlash(inputPath: string): string {
            return inputPath.endsWith("/") ? inputPath : `${inputPath}/`;
        }

        let normalizedDir = ensureTrailingSlash(normalizePath(dir));
        let targetEnvDirList = targetEnvList.map((env) => ensureTrailingSlash(normalizePath(path.join(envDir, env))));
        let sourceDirList = [...targetEnvDirList, normalizedDir];

        function getSourceDirIndex(filePath: string): number {
            return sourceDirList.findIndex((sourceDir) => filePath.startsWith(sourceDir));
        }

        // 先删掉无关环境的配置文件
        let envFiles = (await pathExists(envDir)) ? (await walkParallelPromise(envDir)).map((f) => normalizePath(f)) : [];
        for (let file of envFiles) {
            let isTargetEnvFile = targetEnvDirList.some((sourceDir) => file.startsWith(sourceDir));
            if (isTargetEnvFile) continue;

            ExportLogger.logVerbose(`[OverrideConfigWithEnv] remove unrelated env config file: ${file}`);
            this.recordDeleted(file);
            await rmPath(file);
        }

        // 按 targetEnvList 优先级处理环境目录和外层目录；越靠前优先级越高，外层目录最低
        let files = (await walkParallelPromise(dir))
            .map((f) => normalizePath(f))
            .sort((a, b) => {
                let aIndex = getSourceDirIndex(a);
                let bIndex = getSourceDirIndex(b);
                return (aIndex >= 0 ? aIndex : Number.MAX_SAFE_INTEGER) - (bIndex >= 0 ? bIndex : Number.MAX_SAFE_INTEGER);
            });
        let keptFileNameSet = new Set<string>();
        for (let file of files) {
            let sourceDirIndex = getSourceDirIndex(file);
            if (sourceDirIndex < 0) continue;

            let fileName = path.basename(file);
            if (!keptFileNameSet.has(fileName)) {
                keptFileNameSet.add(fileName);
                continue;
            }

            ExportLogger.logVerbose(`[OverrideConfigWithEnv] remove lower priority overridden config file: ${file}`);
            this.recordDeleted(file);
            await rmPath(file);
        }

        // 删除掉空目录（按最深路径优先，确保子目录先删）
        const allDirs = (await collectSubdirs(dir)).map(normalizePath).sort((a, b) => b.length - a.length);
        for (const d of allDirs) {
            try {
                const filesInDir = await fs.promises.readdir(d);
                if (filesInDir.length === 0) {
                    ExportLogger.logVerbose(`[OverrideConfigWithEnv] remove empty directory: ${d}`);
                    this.recordDeleted(d);
                    await rmPath(d);
                }
            } catch { /* dir may already be removed */ }
        }
    }

    private recordCopiedFileChange(from: string, to: string) {
        if (!fs.existsSync(to)) {
            ExportRunStats.getInstance().recordAdded(to);
            return;
        }

        if (!fs.readFileSync(from).equals(fs.readFileSync(to))) ExportRunStats.getInstance().recordModified(to);
    }

    private async recordCopiedDirChange(from: string, to: string) {
        let files = await walkParallelPromise(from);
        for (let file of files) {
            if (!fs.statSync(file).isFile()) continue;

            let targetPath = path.join(to, path.relative(from, file));
            this.recordCopiedFileChange(file, targetPath);
        }
    }

    private recordDeleted(targetPath: string) {
        if (fs.existsSync(targetPath) && fs.statSync(targetPath).isFile()) ExportRunStats.getInstance().recordDeleted(targetPath);
    }
}
PathOperation.register();
