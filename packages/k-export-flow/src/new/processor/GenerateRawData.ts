import * as path from "path";
import { Worker } from "worker_threads";

import { DataWithSchema, Schema } from "../data";
import { ExportLogger } from "../misc/ExportLogger";
import { Loader, setCsvPreParseCache, clearCsvPreParseCache } from "../misc/Loader";
import { generateMD5, getFileExtension } from "../misc/Util";
import { resolveWorkerScript } from "../misc/WorkerScript";
import { getAvailableParallelism, Processor } from "./Base";
import { DataCache } from "./Util";

import type { IProcessorConfig } from "./Base";

interface IConfig extends IProcessorConfig {
    cacheMode?: boolean;
}

const JSON_STRINGIFY_OPTIONS = { convertObj: false };

const CSV_PARSE_WORKER = resolveWorkerScript(path.join(__dirname, "../misc/CsvParseWorker.js"));

interface CsvWorkerResult {
    results: Array<{ file: string; rows?: string[][]; error?: string }>;
}

async function preCacheCsvFiles(csvPaths: string[]): Promise<void> {
    if (csvPaths.length === 0) return;

    const workerCount = Math.min(getAvailableParallelism(), csvPaths.length, 16);

    // LPT: sort by path length as a proxy for file complexity (no stat overhead)
    const sorted = [...csvPaths].sort((a, b) => b.length - a.length);
    const batches: string[][] = Array.from({ length: workerCount }, () => []);
    for (let i = 0; i < sorted.length; i++) batches[i % workerCount].push(sorted[i]);

    const allResults = await Promise.all(
        batches.map((batch, idx) => new Promise<CsvWorkerResult>((resolve, reject) => {
            const worker = new Worker(CSV_PARSE_WORKER.filename, { workerData: { files: batch }, execArgv: CSV_PARSE_WORKER.execArgv });
            worker.on("message", (r: CsvWorkerResult) => resolve(r));
            worker.on("error", reject);
            worker.on("exit", code => {
                if (code !== 0) reject(new Error(`CsvParse worker ${idx} exited with code ${code}`));
            });
        }))
    );

    for (const { results } of allResults) {
        for (const { file, rows, error } of results) {
            if (rows) setCsvPreParseCache(file, rows);
            else if (error) ExportLogger.logVerbose(`CsvParseWorker error [${file}]: ${error}`);
        }
    }
}

class GenerateRawData extends Processor<GenerateRawData> {
    public inputDataType = Schema;
    public outputDataType = DataWithSchema;

    public async processAll(allData: Array<Schema>) {
        // Pre-parse all CSV files in parallel workers so CsvLoader hits cache instead of blocking the event loop
        const csvPaths = allData
            .filter(s => getFileExtension(s.source.path) === ".csv")
            .map(s => s.source.path);
        await preCacheCsvFiles(csvPaths);

        const result = await super.processAll(allData);
        clearCsvPreParseCache();
        return result;
    }

    public async processSingle(schema: Schema) {
        let cachedOutput = await this.tryGetCache(schema);
        if (cachedOutput) return cachedOutput;

        // 这里如果有需求可以都挪到schema中去处理
        ExportLogger.logVerbose(`generate new raw data: ${schema.source.path}`);
        let ext = getFileExtension(schema.source.path);
        let loader = Loader.create(ext);
        if (!loader) throw new Error(`invalid loader for ${schema.source.path}`);

        let rawData = await loader.loadRawDataObject(schema.source.path, schema.config);
        let serializer = loader.createDataReader();

        let rawObj = await schema.generateRawData(rawData, serializer);

        let output = new DataWithSchema(rawObj, schema);
        output.sourcePath = schema.source.path;
        this.setCache(schema, output);
        return output;
    }

    private tryGetCache(schema: Schema) {
        if (!this.getConfig().cacheMode) return;

        let cacheKey = this.getCacheKey(schema, true);
        let ret = DataCache.get().fetch(cacheKey, true);
        return ret;
    }

    private setCache(schema: Schema, output: DataWithSchema) {
        if (!this.getConfig().cacheMode) return;

        let cacheKey = this.getCacheKey(schema);
        DataCache.get().cache(output, cacheKey);
    }

    private getCacheKey(schema: Schema, forceCalculateConfigHash = false) {
        if (!schema.configHash || forceCalculateConfigHash) schema.configHash = generateMD5(JSON.stringify(schema.config));
        let pathHash = generateMD5(schema.source.path);
        return `${schema.config.name}_${pathHash}_${schema.source.hash}_${schema.configHash}`;
    }

    protected canRunInMultiThread(): boolean {
        return true;
    }
}
GenerateRawData.register();
