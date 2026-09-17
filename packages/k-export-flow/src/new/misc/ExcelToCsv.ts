import * as path from "path";
import * as fs from "fs-extra";
import { Worker } from "worker_threads";
import { getAvailableParallelism, getDefaultConcurrency } from "../processor/Base";
import { resolveWorkerScript } from "./WorkerScript";

const pLimit = require("p-limit");

const WORKER_SCRIPT = resolveWorkerScript(path.join(__dirname, "ExcelToCsvWorker.js"));

interface WorkerTask {
    sourceFile: string;
    targetFile: string;
    sheetName?: string;
    needIgnoreDataAfterEmptyLine?: boolean;
    /** If provided, skip conversion when the computed hash matches (incremental mode). */
    cachedHash?: string;
}

interface WorkerResult {
    hashes: Record<string, string>;
    converted: number;
    errors: Array<{ file: string; error: string }>;
}

const INCREMENT_BUILD_INFO_NAME = "export-csv-increment-info.json";
const FORMULA_CACHE_MISSING_ERROR = "[formula-cache-missing]";

export type Logger = (message: string) => void;
export const defaultLogger: Logger = (message: string) => console.log(message);

export interface IConvertParams {
    sourceBaseDir: string;
    targetBaseDir: string;
    sourceFiles: string[];
    clearTargetFiles?: boolean;
    incrementBuild?: boolean;
    incrementBuildInfoPath?: string;
    replaceNameString: string[][];
    outputLog?: boolean;
    needIgnoreDataAfterEmptyLine?: boolean;
    sheetName?: string;
    ignore?: string[];
    watchWorkerPath?: string;
    /** Optional logger callback. Defaults to console.log when outputLog is true. */
    logger?: Logger;
    /** Concurrency limit for p-limit. Defaults to 4. */
    concurrency?: number;
}

/** Cached entry: hash of the file + stat fingerprint for fast pre-check. */
export interface CacheEntry {
    hash: string;
    mtime: number;
    size: number;
}

async function readIncrementBuildInfo(infoPath: string): Promise<Map<string, CacheEntry>> {
    const ret = new Map<string, CacheEntry>();
    if (await fs.exists(infoPath)) {
        const jsonObj = JSON.parse(await fs.readFile(infoPath, "utf-8"));
        for (const key in jsonObj) {
            if (!Object.hasOwn(jsonObj, key)) continue;
            const v = jsonObj[key];
            // Support old format (plain hash string) and new format (object with hash/mtime/size).
            if (typeof v === "string") {
                ret.set(key, { hash: v, mtime: 0, size: 0 });
            } else if (v && typeof v.hash === "string") {
                ret.set(key, v as CacheEntry);
            }
        }
    }
    return ret;
}

async function verifyTargetFile(params: IConvertParams, sourceFile: string) {
    let relativeDir = path.relative(params.sourceBaseDir, path.dirname(sourceFile));
    let targetFileDir = path.join(params.targetBaseDir, relativeDir);
    let targetFile = path.join(targetFileDir, path.basename(sourceFile, ".xlsx") + ".csv");
    if (params.replaceNameString.length > 0) {
        for (let r of params.replaceNameString) {
            targetFile = targetFile.replaceAll(r[0], r[1]);
        }
    }
    await fs.ensureDir(targetFileDir);
    return targetFile;
}

export interface IConvertResult {
    incrementBuildInfo?: Map<string, CacheEntry>;
    incrementBuildInfoPath?: string;
}

/** Dispatch a pre-built task list to worker threads and collect results. */
async function dispatchToWorkers(tasks: WorkerTask[], params: IConvertParams): Promise<WorkerResult> {
    const log = params.logger ?? defaultLogger;

    // LPT: sort largest files first so big files spread across workers, reducing tail-worker latency
    const sizes = new Map<string, number>();
    await Promise.all(tasks.map(async t => {
        try { sizes.set(t.sourceFile, (await fs.stat(t.sourceFile)).size); }
        catch { sizes.set(t.sourceFile, 0); }
    }));
    tasks.sort((a, b) => (sizes.get(b.sourceFile) ?? 0) - (sizes.get(a.sourceFile) ?? 0));

    const workerCount = Math.min(getAvailableParallelism(), tasks.length, 8);
    const batches: WorkerTask[][] = Array.from({ length: workerCount }, () => []);
    for (let i = 0; i < tasks.length; i++) batches[i % workerCount].push(tasks[i]);

    if (params.outputLog) log(`ConvertExcelToCsv: converting ${tasks.length} files with ${workerCount} workers, please wait...`);

    const results = await Promise.all(
        batches.map((batch, idx) => new Promise<WorkerResult>((resolve, reject) => {
            const worker = new Worker(WORKER_SCRIPT.filename, { workerData: { tasks: batch }, execArgv: WORKER_SCRIPT.execArgv });
            worker.on("message", (result: WorkerResult) => resolve(result));
            worker.on("error", reject);
            worker.on("exit", (code) => {
                if (code !== 0) reject(new Error(`ExcelToCsv worker ${idx} exited with code ${code}`));
            });
        }))
    );

    const merged: WorkerResult = { hashes: Object.create(null), converted: 0, errors: [] };
    for (const r of results) {
        Object.assign(merged.hashes, r.hashes);
        merged.converted += r.converted;
        merged.errors.push(...r.errors);
    }
    if (merged.errors.length > 0) {
        const isFormulaCacheMissingError = (err: { error: string }) =>
            err.error === FORMULA_CACHE_MISSING_ERROR || err.error.startsWith(`${FORMULA_CACHE_MISSING_ERROR}\n`);
        const formatFormulaCacheMissingError = (err: { file: string; error: string }) => {
            const details = err.error.slice(FORMULA_CACHE_MISSING_ERROR.length).trim();
            if (!details) return `  - ${err.file}`;
            return [
                `  - ${err.file}`,
                ...details.split(/\r?\n/).map((line) => `    ${line}`),
            ].join("\n");
        };
        const formulaCacheMissingFiles = merged.errors
            .filter(isFormulaCacheMissingError)
            .map(formatFormulaCacheMissingError);
        const otherErrors = merged.errors.filter((err) => !isFormulaCacheMissingError(err));

        for (const err of otherErrors) log(`error converting ${err.file}: ${err.error}`);

        const details = [
            formulaCacheMissingFiles.length > 0
                ? `以下 Excel 公式缺少缓存值，请打开并保存后重试:\n${formulaCacheMissingFiles.join("\n")}`
                : undefined,
            ...otherErrors.map((err) => `${err.file}: ${err.error}`),
        ].filter((item): item is string => item !== undefined).join("\n");
        throw new Error(details);
    }
    if (params.outputLog) log(`ConvertExcelToCsv: converted ${merged.converted} files`);
    return merged;
}

export async function convertExcelToCsv(params: IConvertParams): Promise<IConvertResult> {
    if (params.clearTargetFiles) {
        const log = params.logger ?? defaultLogger;
        log("verbose: clear target files");
        fs.removeSync(params.targetBaseDir);
    }

    await fs.ensureDir(params.targetBaseDir);

    const log = params.logger ?? defaultLogger;

    // Load hash cache: empty for full rebuild, from disk for incremental.
    const infoPath = params.incrementBuildInfoPath
        ? path.join(params.incrementBuildInfoPath, INCREMENT_BUILD_INFO_NAME)
        : undefined;
    const cachedEntries = (params.incrementBuild && infoPath)
        ? await readIncrementBuildInfo(infoPath)
        : new Map<string, CacheEntry>();

    // Build task list.
    // Main thread only does stat() — no file reading.
    // Incremental: files whose mtime+size match the cache are skipped entirely.
    // Files that may have changed get a cachedHash so the worker can verify and skip conversion
    // if the actual content hasn't changed (e.g. mtime bumped without content change).
    const tasks: WorkerTask[] = [];
    const limit = pLimit(params.concurrency ?? getDefaultConcurrency());

    await Promise.all(params.sourceFiles.map(sourceFile => limit(async () => {
        if (path.basename(sourceFile).startsWith("~$")) return;

        const targetFile = await verifyTargetFile(params, sourceFile);
        const filePath = sourceFile.replaceAll("\\", "/");

        if (!fs.existsSync(sourceFile)) {
            cachedEntries.delete(filePath);
            if (fs.existsSync(targetFile)) {
                fs.rmSync(targetFile);
                if (params.outputLog) log(`delete ${targetFile}`);
            }
            return;
        }

        if (params.incrementBuild) {
            const cached = cachedEntries.get(filePath);
            if (cached) {
                const st = await fs.stat(sourceFile);
                // mtime and size both match → file content almost certainly unchanged, skip entirely.
                if (st.mtimeMs === cached.mtime && st.size === cached.size) return;
                // stat changed → dispatch to worker with cached hash so it can still skip conversion
                // if the content hash matches (e.g. only mtime bumped without content change).
                tasks.push({ sourceFile, targetFile, sheetName: params.sheetName, needIgnoreDataAfterEmptyLine: params.needIgnoreDataAfterEmptyLine, cachedHash: cached.hash });
                return;
            }
        }

        tasks.push({ sourceFile, targetFile, sheetName: params.sheetName, needIgnoreDataAfterEmptyLine: params.needIgnoreDataAfterEmptyLine });
    })));

    if (tasks.length === 0) {
        if (params.outputLog) log(`ConvertExcelToCsv: 0 files changed`);
        return { incrementBuildInfo: cachedEntries, incrementBuildInfoPath: params.incrementBuildInfoPath };
    }

    const result = await dispatchToWorkers(tasks, params);

    // Merge worker-returned hashes (with fresh stat) back into the cache.
    for (const [filePath, hash] of Object.entries(result.hashes)) {
        try {
            const st = await fs.stat(filePath);
            cachedEntries.set(filePath, { hash, mtime: st.mtimeMs, size: st.size });
        } catch {
            cachedEntries.set(filePath, { hash, mtime: 0, size: 0 });
        }
    }

    return { incrementBuildInfo: cachedEntries, incrementBuildInfoPath: params.incrementBuildInfoPath };
}
