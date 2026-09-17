import * as fs from "node:fs";
import * as path from "node:path";
import { Worker } from "node:worker_threads";

import { generateDts } from "./DtsGenerator";
import { IExportOptions, IncrementalExportState } from "./IncrementalExportState";
import { LuaDescGenerator } from "./LuaDescGenerator";
import { generateMonoProto } from "./MonoProtoGenerator";
import { collectProtoFiles, loadRoot } from "./RootLoader";
import { TsIndexGenerator } from "./TsIndexGenerator";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const uglifyJs = require("uglify-js");

function normalize(opts: IExportOptions): IExportOptions {
    const requiredKeys = ["protoRootPath", "sourcePath", "targetTsPath", "targetLuaPath"] as const;
    for (const key of requiredKeys) {
        if (!opts[key]) {
            throw new Error(`[export-proto-to-kts] missing required option --${key}`);
        }
    }
    return {
        ...opts,
        protoRootPath: path.resolve(opts.protoRootPath),
        sourcePath: path.resolve(opts.sourcePath),
        targetTsPath: path.resolve(opts.targetTsPath),
        targetLuaPath: path.resolve(opts.targetLuaPath),
        monoProtoPath: opts.monoProtoPath ? path.resolve(opts.monoProtoPath) : undefined,
        bundleJsPath: opts.bundleJsPath ? path.resolve(opts.bundleJsPath) : undefined,
        bundleDtsPath: opts.bundleDtsPath ? path.resolve(opts.bundleDtsPath) : undefined,
        distBundleJsPath: opts.distBundleJsPath ? path.resolve(opts.distBundleJsPath) : undefined,
        ignorePaths: opts.ignorePaths?.map((p) => path.resolve(p)),
    };
}

function ensureDir(filePath: string) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

/** 在 Worker 线程中生成 jsBundle，与主线程并发执行 */
function startJsBundleWorker(protoRootPath: string, protoFiles: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
        // tsx/cjs 注入确保 Worker 内能解析 TypeScript
        const tsxCjs = require.resolve("tsx/cjs");
        const workerPath = path.join(__dirname, "JsBundleWorker.ts");
        const worker = new Worker(
            `require(${JSON.stringify(tsxCjs)});require(${JSON.stringify(workerPath)});`,
            { eval: true, workerData: { protoRootPath, protoFiles } },
        );
        worker.on("message", resolve);
        worker.on("error", reject);
        worker.on("exit", (code) => {
            if (code !== 0) reject(new Error(`JsBundleWorker exited with code ${code}`));
        });
    });
}

export class ProtoExportCli {
    static async export(opts: IExportOptions) {
        const normalizedOpts = normalize(opts);
        const incrementResult = IncrementalExportState.check(normalizedOpts);

        if (opts.increment && !incrementResult.shouldExport) {
            console.log(`[increment] ${incrementResult.reason} — skip export.`);
            return;
        }
        if (opts.increment) {
            console.log(`[increment] ${incrementResult.reason} — run full export.`);
        }

        console.time("[export-proto] total");

        // ── 1. 收集 proto 文件列表（仅 glob 一次）────────────────────────
        const protoFilesGlob = collectProtoFiles(
            normalizedOpts.sourcePath,
            normalizedOpts.protoRootPath,
            normalizedOpts.ignorePaths,
        );

        // ── 2. 并发：Worker 线程承担 loadRoot + jsBundle（最慢步骤）────
        console.time("[export-proto] jsBundle");
        const jsBundlePromise = startJsBundleWorker(
            normalizedOpts.protoRootPath,
            protoFilesGlob,
        );

        // ── 3. 主线程：加载 Root 一次（glob 顺序）──────────────────────
        console.time("[export-proto] loadRoot");
        const root = loadRoot(normalizedOpts.protoRootPath, protoFilesGlob);
        console.timeEnd("[export-proto] loadRoot");

        // ── 4. 主线程顺序执行快速步骤（与 Worker 并发）─────────────────
        // TsIndex / Lua 生成器内部按名称排序，无需单独的 alphaRoot
        console.time("[export-proto] tsIndex");
        new TsIndexGenerator({
            number64TargetType: normalizedOpts.convertAllNumber64To,
            convertPBMapToJSMap: normalizedOpts.convertPBMapToJSMap,
            protocolRegisterModule: normalizedOpts.protocolRegisterModule,
        }).generate(root, normalizedOpts.targetTsPath);
        console.timeEnd("[export-proto] tsIndex");

        console.time("[export-proto] lua");
        new LuaDescGenerator().generate(root, normalizedOpts.targetLuaPath);
        console.timeEnd("[export-proto] lua");

        if (normalizedOpts.monoProtoPath) {
            console.time("[export-proto] monoProto");
            ensureDir(normalizedOpts.monoProtoPath);
            fs.writeFileSync(normalizedOpts.monoProtoPath, generateMonoProto(root));
            console.timeEnd("[export-proto] monoProto");
        }

        console.time("[export-proto] dts");
        if (normalizedOpts.bundleDtsPath) {
            ensureDir(normalizedOpts.bundleDtsPath);
            fs.writeFileSync(normalizedOpts.bundleDtsPath, generateDts(root));
        }
        console.timeEnd("[export-proto] dts");

        // ── 5. 等待 Worker 完成，写 jsBundle / distJs ───────────────────
        const jsBundle = await jsBundlePromise;
        console.timeEnd("[export-proto] jsBundle");

        if (normalizedOpts.bundleJsPath) {
            ensureDir(normalizedOpts.bundleJsPath);
            fs.writeFileSync(normalizedOpts.bundleJsPath, jsBundle);
        }

        if (normalizedOpts.distBundleJsPath && jsBundle) {
            console.time("[export-proto] distJs");
            ensureDir(normalizedOpts.distBundleJsPath);
            if (normalizedOpts.minify) {
                const minResult = uglifyJs.minify(jsBundle);
                if (minResult.error) throw new Error(`uglify-js failed: ${minResult.error}`);
                fs.writeFileSync(normalizedOpts.distBundleJsPath, minResult.code!);
            } else {
                fs.writeFileSync(normalizedOpts.distBundleJsPath, jsBundle);
            }
            console.timeEnd("[export-proto] distJs");
        }

        console.timeEnd("[export-proto] total");

        IncrementalExportState.write(normalizedOpts, incrementResult.currentState);
    }
}
