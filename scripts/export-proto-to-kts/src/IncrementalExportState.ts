import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export interface IExportOptions {
    protoRootPath: string;
    sourcePath: string;
    targetTsPath: string;
    targetLuaPath: string;
    ignorePaths?: string[];
    convertAllNumber64To?: string;
    convertPBMapToJSMap?: boolean;
    monoProtoPath?: string;
    bundleJsPath?: string;
    bundleDtsPath?: string;
    distBundleJsPath?: string;
    /** 协议注册函数所在模块名;未配置时生成的 index.ts 不包含注册代码 */
    protocolRegisterModule?: string;
    /** 增量缓存文件路径;默认取 bundle 输出目录(或 targetTsPath)旁的 proto-export-increment-cache.json */
    incrementCachePath?: string;
    /** --minify: 是否压缩 dist pb-bundle.js */
    minify?: boolean;
    increment?: boolean;
}

interface IProtoFileState {
    path: string;
    hash: string;
    size: number;
}

interface ICachedState {
    version: 2;
    optionsHash: string;
    files: IProtoFileState[];
}

const STATE_VERSION = 2;
const DEFAULT_CACHE_FILE_NAME = "proto-export-increment-cache.json";

export interface IIncrementalCheckResult {
    shouldExport: boolean;
    reason: string;
    currentState: ICachedState;
}

export class IncrementalExportState {
    static check(opts: IExportOptions): IIncrementalCheckResult {
        const currentState = this.buildCurrentState(opts);
        const cachePath = this.cachePath(opts);
        const prev = this.readCache(cachePath);

        if (!this.hasRequiredOutputs(opts)) {
            return { shouldExport: true, reason: "output files missing", currentState };
        }
        if (!prev) {
            return { shouldExport: true, reason: "no increment cache", currentState };
        }
        if (prev.version !== STATE_VERSION) {
            return { shouldExport: true, reason: "cache version changed", currentState };
        }
        if (prev.optionsHash !== currentState.optionsHash) {
            return { shouldExport: true, reason: "options changed", currentState };
        }
        if (!this.sameFiles(prev.files, currentState.files)) {
            return { shouldExport: true, reason: "proto files changed", currentState };
        }
        return { shouldExport: false, reason: "no changes", currentState };
    }

    static write(opts: IExportOptions, state: ICachedState) {
        const cachePath = this.cachePath(opts);
        fs.mkdirSync(path.dirname(cachePath), { recursive: true });
        fs.writeFileSync(cachePath, JSON.stringify(state, undefined, 2));
    }

    private static buildCurrentState(opts: IExportOptions): ICachedState {
        return {
            version: STATE_VERSION,
            optionsHash: this.optionsHash(opts),
            files: this.collectFileStates(opts),
        };
    }

    private static collectFileStates(opts: IExportOptions): IProtoFileState[] {
        const { collectProtoFiles } = require("./RootLoader");
        const files: string[] = collectProtoFiles(opts.sourcePath, opts.protoRootPath, opts.ignorePaths);
        return files
            .map((rel) => {
                const abs = path.resolve(opts.protoRootPath, rel);
                const buf = fs.readFileSync(abs);
                return {
                    path: rel,
                    hash: crypto.createHash("sha1").update(buf).digest("hex"),
                    size: buf.length,
                };
            })
            .sort((a, b) => a.path.localeCompare(b.path));
    }

    private static optionsHash(opts: IExportOptions): string {
        const snapshot = {
            protoRootPath: path.resolve(opts.protoRootPath),
            sourcePath: path.resolve(opts.sourcePath),
            targetTsPath: path.resolve(opts.targetTsPath),
            targetLuaPath: path.resolve(opts.targetLuaPath),
            monoProtoPath: opts.monoProtoPath ? path.resolve(opts.monoProtoPath) : "",
            bundleJsPath: opts.bundleJsPath ? path.resolve(opts.bundleJsPath) : "",
            bundleDtsPath: opts.bundleDtsPath ? path.resolve(opts.bundleDtsPath) : "",
            distBundleJsPath: opts.distBundleJsPath ? path.resolve(opts.distBundleJsPath) : "",
            protocolRegisterModule: opts.protocolRegisterModule ?? "",
            minify: opts.minify ?? false,
            ignorePaths: (opts.ignorePaths ?? []).map((p) => path.resolve(p)).sort(),
            convertAllNumber64To: opts.convertAllNumber64To ?? "",
            convertPBMapToJSMap: opts.convertPBMapToJSMap ?? false,
        };
        return crypto.createHash("sha1").update(JSON.stringify(snapshot)).digest("hex");
    }

    private static hasRequiredOutputs(opts: IExportOptions): boolean {
        const required = [
            path.join(opts.targetTsPath, "index.ts"),
            path.join(opts.targetLuaPath, "ProtoDescs.lua"),
            opts.monoProtoPath,
            opts.bundleJsPath,
            opts.bundleDtsPath,
            opts.distBundleJsPath,
        ].filter(Boolean) as string[];
        return required.every((p) => fs.existsSync(p));
    }

    private static sameFiles(left: IProtoFileState[], right: IProtoFileState[]): boolean {
        if (left.length !== right.length) return false;
        return left.every((l, i) => {
            const r = right[i];
            return l.path === r.path && l.hash === r.hash && l.size === r.size;
        });
    }

    private static readCache(cachePath: string): ICachedState | undefined {
        if (!fs.existsSync(cachePath)) return undefined;
        try {
            return JSON.parse(fs.readFileSync(cachePath, "utf8")) as ICachedState;
        } catch {
            return undefined;
        }
    }

    private static cachePath(opts: IExportOptions): string {
        if (opts.incrementCachePath) {
            return path.resolve(opts.incrementCachePath);
        }
        const anchor = opts.bundleJsPath ?? opts.monoProtoPath ?? opts.targetTsPath;
        return path.resolve(path.dirname(anchor), DEFAULT_CACHE_FILE_NAME);
    }
}
