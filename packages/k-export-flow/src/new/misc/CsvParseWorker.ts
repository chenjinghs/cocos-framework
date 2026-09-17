import { workerData, parentPort } from "worker_threads";
import * as fs from "fs";
import * as csv from "csv-parse/sync";

interface CsvWorkerResult {
    results: Array<{ file: string; rows?: string[][]; error?: string }>;
}

const { files } = workerData as { files: string[] };
const results: CsvWorkerResult["results"] = [];

for (const file of files) {
    try {
        let data = fs.readFileSync(file, "utf-8");
        if (data.charCodeAt(0) === 0xFEFF) data = data.slice(1); // strip BOM
        const rows = csv.parse(data, {
            relax_quotes: true,
            relax_column_count: true,
            skip_empty_lines: true,
            skip_records_with_empty_values: true,
        }) as string[][];
        results.push({ file, rows });
    } catch (e: any) {
        results.push({ file, error: e.message });
    }
}

parentPort!.postMessage({ results } as CsvWorkerResult);
