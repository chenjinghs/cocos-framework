import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { spawnSync } from "child_process";

import type { SpawnSyncReturns } from "child_process";

const CACHE_FILE_NAMES = [
    "export-csv-increment-info.json",
    "early-filter-file-path-data-info.json",
    "filter-changed-schema.json",
    "filter-changed-file-path-data-info.json",
];

type CacheSnapshot = Map<string, Buffer | undefined>;

interface ICommandResult {
    command: string;
    exitCode: number;
    signal?: NodeJS.Signals;
    stdout: string;
    stderr: string;
    output: string;
    error?: string;
}

interface IPreparedCacheSnapshot {
    snapshot: CacheSnapshot;
    selectedXlsxPath: string;
    selectedCsvPath: string;
    removedSchemaEntry: boolean;
}

interface IFailureMode {
    key: "sync" | "async";
    title: string;
    failingHandlerName: string;
    evidenceFileName: string;
    preloadSource: string;
}

interface IFailureRunReport {
    mode: IFailureMode;
    result: ICommandResult;
    beforeHashes: Map<string, string>;
    afterHashes: Map<string, string>;
    tempPreloadPath: string;
    tempPreloadDeleted: boolean;
    problems: string[];
}

const typeScriptsRoot = path.resolve(__dirname, "../../..");
const resProjectRoot = path.resolve(typeScriptsRoot, "..");
const workspaceRoot = path.resolve(resProjectRoot, "..");
const cacheRoot = path.join(resProjectRoot, "TempSaved", "export-flow");
const evidenceRoot = path.join(workspaceRoot, ".sisyphus", "evidence", "export-flow-full-closure");
const tempRoot = path.join(os.tmpdir(), "postprocess-failure-harness");
const staleHashValue = "postprocess-failure-harness-stale-hash";

const failureModes: IFailureMode[] = [
    {
        key: "sync",
        title: "sync throw",
        failingHandlerName: "T11PostProcessHarnessSyncThrow",
        evidenceFileName: "task-11-sync-failure.txt",
        preloadSource: createSyncPreloadSource("T11PostProcessHarnessSyncThrow"),
    },
    {
        key: "async",
        title: "async reject",
        failingHandlerName: "T11PostProcessHarnessAsyncReject",
        evidenceFileName: "task-11-async-reject.txt",
        preloadSource: createAsyncPreloadSource("T11PostProcessHarnessAsyncReject"),
    },
];

function createSyncPreloadSource(handlerName: string) {
    return [
        "import { P } from \"k-export-flow\";",
        `P.DataPostProcess.registerAllDataPostProcess(${JSON.stringify(handlerName)}, () => {`,
        `    throw new Error(${JSON.stringify(`${handlerName} intentional sync throw`)});`,
        "}, -1000000);",
        "",
    ].join("\n");
}

function createAsyncPreloadSource(handlerName: string) {
    return [
        "import { P } from \"k-export-flow\";",
        `P.DataPostProcess.registerAllDataPostProcess(${JSON.stringify(handlerName)}, async () => {`,
        `    throw new Error(${JSON.stringify(`${handlerName} intentional async reject`)});`,
        "}, -1000000);",
        "",
    ].join("\n");
}

function cacheFilePath(fileName: string) {
    return path.join(cacheRoot, fileName);
}

function snapshotCacheFiles(): CacheSnapshot {
    const snapshot: CacheSnapshot = new Map();
    for (const fileName of CACHE_FILE_NAMES) {
        const filePath = cacheFilePath(fileName);
        snapshot.set(fileName, fs.existsSync(filePath) ? fs.readFileSync(filePath) : undefined);
    }
    return snapshot;
}

function cloneSnapshot(snapshot: CacheSnapshot): CacheSnapshot {
    const clone: CacheSnapshot = new Map();
    for (const [fileName, data] of snapshot) {
        clone.set(fileName, data ? Buffer.from(data) : undefined);
    }
    return clone;
}

function restoreSnapshot(snapshot: CacheSnapshot) {
    fs.mkdirSync(cacheRoot, { recursive: true });
    for (const [fileName, data] of snapshot) {
        const filePath = cacheFilePath(fileName);
        if (data) {
            fs.writeFileSync(filePath, data);
        } else if (fs.existsSync(filePath)) {
            fs.rmSync(filePath);
        }
    }
}

function hashCacheFiles() {
    const hashes = new Map<string, string>();
    for (const fileName of CACHE_FILE_NAMES) {
        const filePath = cacheFilePath(fileName);
        if (!fs.existsSync(filePath)) {
            hashes.set(fileName, "MISSING");
            continue;
        }

        const fileHash = crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
        hashes.set(fileName, fileHash);
    }
    return hashes;
}

function parseJsonObject(data: Buffer | undefined, fileName: string): Record<string, unknown> {
    if (!data) throw new Error(`required cache file missing: ${fileName}`);
    const parsed = JSON.parse(data.toString("utf-8")) as unknown;
    if (!isRecord(parsed)) throw new Error(`cache file is not a JSON object: ${fileName}`);
    return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getPathProperty(value: unknown) {
    if (!isRecord(value)) return undefined;
    const maybePath = value.path;
    return typeof maybePath === "string" ? maybePath : undefined;
}

function normalizePathForCompare(value: string) {
    return value.replaceAll("\\", "/").toLowerCase();
}

function baseNameWithoutExt(value: string) {
    return path.basename(value, path.extname(value)).toLowerCase();
}

function createPreparedSnapshot(original: CacheSnapshot): IPreparedCacheSnapshot {
    const snapshot = cloneSnapshot(original);
    const exportInfo = parseJsonObject(snapshot.get("export-csv-increment-info.json"), "export-csv-increment-info.json");
    const schemaInfo = parseJsonObject(snapshot.get("filter-changed-schema.json"), "filter-changed-schema.json");
    const schemaData = Array.isArray(schemaInfo.data) ? schemaInfo.data : [];
    const xlsxPaths = Object.keys(exportInfo);

    if (xlsxPaths.length === 0) throw new Error("export-csv-increment-info.json has no xlsx entries to stale");

    let selectedXlsxPath = xlsxPaths[0];
    let selectedCsvPath = "";

    for (const entry of schemaData) {
        const csvPath = getPathProperty(entry);
        if (!csvPath) continue;
        const csvBaseName = baseNameWithoutExt(csvPath);
        const matchedXlsx = xlsxPaths.find((xlsxPath) => baseNameWithoutExt(xlsxPath) === csvBaseName);
        if (!matchedXlsx) continue;

        selectedXlsxPath = matchedXlsx;
        selectedCsvPath = csvPath;
        break;
    }

    if (!selectedCsvPath) {
        selectedCsvPath = selectedXlsxPath.replace("/ExternalConfig/design-config/new_src/", "/TempSaved/export-flow/csv/").replace(/\.xlsx$/i, ".csv");
    }

    exportInfo[selectedXlsxPath] = staleHashValue;
    snapshot.set("export-csv-increment-info.json", Buffer.from(JSON.stringify(exportInfo), "utf-8"));

    const selectedCsvPathNormalized = normalizePathForCompare(selectedCsvPath);
    const filteredSchemaData = schemaData.filter((entry) => {
        const entryPath = getPathProperty(entry);
        return !entryPath || normalizePathForCompare(entryPath) !== selectedCsvPathNormalized;
    });
    const removedSchemaEntry = filteredSchemaData.length !== schemaData.length;
    schemaInfo.data = filteredSchemaData;
    snapshot.set("filter-changed-schema.json", Buffer.from(JSON.stringify(schemaInfo), "utf-8"));

    return {
        snapshot,
        selectedXlsxPath,
        selectedCsvPath,
        removedSchemaEntry,
    };
}

function runIncrementExport(envPatch: NodeJS.ProcessEnv = {}): ICommandResult {
    fs.mkdirSync(tempRoot, { recursive: true });
    const command = "yarn";
    const args = ["export-data-table-increment"];
    const outputPrefix = path.join(tempRoot, `increment-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const stdoutPath = `${outputPrefix}.stdout.log`;
    const stderrPath = `${outputPrefix}.stderr.log`;
    const stdoutFd = fs.openSync(stdoutPath, "w");
    const stderrFd = fs.openSync(stderrPath, "w");

    let result: SpawnSyncReturns<Buffer>;
    try {
        result = spawnSync(command, args, {
            cwd: typeScriptsRoot,
            env: { ...process.env, ...envPatch },
            shell: process.platform === "win32",
            stdio: ["ignore", stdoutFd, stderrFd],
            timeout: 300000,
            windowsHide: true,
        });
    } finally {
        fs.closeSync(stdoutFd);
        fs.closeSync(stderrFd);
    }

    const stdout = fs.existsSync(stdoutPath) ? fs.readFileSync(stdoutPath, "utf-8") : "";
    const stderr = fs.existsSync(stderrPath) ? fs.readFileSync(stderrPath, "utf-8") : "";
    if (fs.existsSync(stdoutPath)) fs.rmSync(stdoutPath);
    if (fs.existsSync(stderrPath)) fs.rmSync(stderrPath);

    return normalizeSpawnResult(`${command} ${args.join(" ")}`, result, stdout, stderr);
}

function normalizeSpawnResult(command: string, result: SpawnSyncReturns<string> | SpawnSyncReturns<Buffer>, stdout: string, stderr: string): ICommandResult {
    const output = `${stdout}${stderr}`;
    const exitCode = typeof result.status === "number" ? result.status : 1;
    const normalized: ICommandResult = {
        command,
        exitCode,
        stdout,
        stderr,
        output,
    };

    if (result.signal) normalized.signal = result.signal;
    if (result.error) normalized.error = result.error.message;
    return normalized;
}

function runFailureMode(mode: IFailureMode): IFailureRunReport {
    fs.mkdirSync(tempRoot, { recursive: true });
    const tempPreloadPath = path.join(tempRoot, `${mode.key}-postprocess-registration.ts`);
    fs.writeFileSync(tempPreloadPath, mode.preloadSource, "utf-8");

    const beforeHashes = hashCacheFiles();
    const nodeOptions = appendNodeOptions(process.env.NODE_OPTIONS, ["--require", "tsx/cjs", "--require", toNodeOptionPath(tempPreloadPath)]);
    const result = runIncrementExport({ NODE_OPTIONS: nodeOptions });
    const afterHashes = hashCacheFiles();

    let tempPreloadDeleted = false;
    if (fs.existsSync(tempPreloadPath)) {
        fs.rmSync(tempPreloadPath);
        tempPreloadDeleted = !fs.existsSync(tempPreloadPath);
    }

    const report: IFailureRunReport = {
        mode,
        result,
        beforeHashes,
        afterHashes,
        tempPreloadPath,
        tempPreloadDeleted,
        problems: [],
    };
    report.problems = collectFailureReportProblems(report);
    return report;
}

function toNodeOptionPath(filePath: string) {
    const normalizedPath = filePath.replaceAll("\\", "/");
    return normalizedPath.includes(" ") ? JSON.stringify(normalizedPath) : normalizedPath;
}

function appendNodeOptions(existingOptions: string | undefined, extraOptions: string[]) {
    const parts = [];
    if (existingOptions?.trim()) parts.push(existingOptions.trim());
    parts.push(...extraOptions);
    return parts.join(" ");
}

function collectFailureReportProblems(report: IFailureRunReport) {
    const problems: string[] = [];
    if (report.result.exitCode === 0) problems.push(`${report.mode.title} export exited 0; expected non-zero`);
    if (!report.result.output.includes("[POST_PROCESS]")) problems.push(`${report.mode.title} log missing [POST_PROCESS]`);
    if (!report.result.output.includes(report.mode.failingHandlerName)) problems.push(`${report.mode.title} log missing handler ${report.mode.failingHandlerName}`);
    if (!hashesUnchanged(report.beforeHashes, report.afterHashes)) problems.push(`${report.mode.title} cache hashes changed during failing run`);
    if (!report.tempPreloadDeleted) problems.push(`${report.mode.title} temp preload was not deleted: ${report.tempPreloadPath}`);
    return problems;
}

function hashesUnchanged(beforeHashes: Map<string, string>, afterHashes: Map<string, string>) {
    return CACHE_FILE_NAMES.every((fileName) => beforeHashes.get(fileName) === afterHashes.get(fileName));
}

function formatHashes(title: string, hashes: Map<string, string>) {
    const lines = [`${title}:`];
    for (const fileName of CACHE_FILE_NAMES) {
        lines.push(`  ${fileName}: ${hashes.get(fileName) ?? "UNHASHED"}`);
    }
    return lines.join("\n");
}

function formatOutputSnippet(output: string) {
    const maxLength = 12000;
    if (output.length <= maxLength) return output;
    return `${output.slice(0, maxLength)}\n...<truncated ${output.length - maxLength} chars>`;
}

function formatFailureReport(report: IFailureRunReport, prepared: IPreparedCacheSnapshot) {
    const lines = [
        `# T11 postprocess failure harness - ${report.mode.title}`,
        `command: ${report.result.command}`,
        `exitCode: ${report.result.exitCode}`,
        `signal: ${report.result.signal ?? "none"}`,
        `error: ${report.result.error ?? "none"}`,
        `failingHandler: ${report.mode.failingHandlerName}`,
        `selectedXlsxPath: ${prepared.selectedXlsxPath}`,
        `selectedCsvPath: ${prepared.selectedCsvPath}`,
        `removedSchemaEntry: ${prepared.removedSchemaEntry}`,
        `tempPreloadPath: ${report.tempPreloadPath}`,
        `tempPreloadDeleted: ${report.tempPreloadDeleted}`,
        `cacheInvariant: ${hashesUnchanged(report.beforeHashes, report.afterHashes) ? "PASS" : "FAIL"}`,
        `problems: ${report.problems.length === 0 ? "none" : report.problems.join("; ")}`,
        "",
        formatHashes("before", report.beforeHashes),
        formatHashes("after", report.afterHashes),
        "",
        "## captured output",
        formatOutputSnippet(report.result.output),
        "",
    ];
    return lines.join("\n");
}

function formatCacheInvariantEvidence(reports: IFailureRunReport[], normalResult: ICommandResult | undefined, prepared: IPreparedCacheSnapshot, caughtError: unknown) {
    const lines = [
        "# T11 cache invariant and cleanup evidence",
        `selectedXlsxPath: ${prepared.selectedXlsxPath}`,
        `selectedCsvPath: ${prepared.selectedCsvPath}`,
        `removedSchemaEntry: ${prepared.removedSchemaEntry}`,
        `staleHashValue: ${staleHashValue}`,
        "",
    ];

    for (const report of reports) {
        lines.push(`## ${report.mode.title}`);
        lines.push(`exitCode: ${report.result.exitCode}`);
        lines.push(`failingHandler: ${report.mode.failingHandlerName}`);
        lines.push(`cacheInvariant: ${hashesUnchanged(report.beforeHashes, report.afterHashes) ? "PASS" : "FAIL"}`);
        lines.push(`tempPreloadDeleted: ${report.tempPreloadDeleted}`);
        lines.push(`problems: ${report.problems.length === 0 ? "none" : report.problems.join("; ")}`);
        lines.push(formatHashes("before", report.beforeHashes));
        lines.push(formatHashes("after", report.afterHashes));
        lines.push("");
    }

    lines.push("## cleanup normal increment");
    if (normalResult) {
        lines.push(`command: ${normalResult.command}`);
        lines.push(`exitCode: ${normalResult.exitCode}`);
        lines.push(`signal: ${normalResult.signal ?? "none"}`);
        lines.push(`error: ${normalResult.error ?? "none"}`);
        lines.push("capturedOutput:");
        lines.push(formatOutputSnippet(normalResult.output));
    } else {
        lines.push("not run");
    }

    lines.push("");
    lines.push("## harness result");
    lines.push(caughtError ? `FAIL: ${formatUnknownError(caughtError)}` : "PASS");
    return lines.join("\n");
}

function formatUnknownError(error: unknown) {
    if (error instanceof Error) return `${error.message}\n${error.stack ?? ""}`;
    return String(error);
}

function writeEvidence(reports: IFailureRunReport[], normalResult: ICommandResult | undefined, prepared: IPreparedCacheSnapshot, caughtError: unknown) {
    fs.mkdirSync(evidenceRoot, { recursive: true });
    for (const report of reports) {
        if (!report.mode.evidenceFileName) continue;
        fs.writeFileSync(path.join(evidenceRoot, report.mode.evidenceFileName), formatFailureReport(report, prepared), "utf-8");
    }

    fs.writeFileSync(
        path.join(evidenceRoot, "task-11-cache-invariant.txt"),
        formatCacheInvariantEvidence(reports, normalResult, prepared, caughtError),
        "utf-8",
    );
}

function assertNoReportProblems(reports: IFailureRunReport[]) {
    const allProblems = reports.flatMap((report) => report.problems.map((problem) => `${report.mode.title}: ${problem}`));
    if (allProblems.length > 0) throw new Error(allProblems.join("\n"));
}

function assertNormalIncrementSucceeded(result: ICommandResult) {
    if (result.exitCode !== 0) {
        throw new Error(`cleanup normal increment failed with exit code ${result.exitCode}\n${formatOutputSnippet(result.output)}`);
    }
}

async function main() {
    const originalSnapshot = snapshotCacheFiles();
    const prepared = createPreparedSnapshot(originalSnapshot);
    const reports: IFailureRunReport[] = [];
    let normalResult: ICommandResult | undefined;
    let caughtError: unknown;

    try {
        for (const mode of failureModes) {
            restoreSnapshot(prepared.snapshot);
            const report = runFailureMode(mode);
            reports.push(report);
            assertNoReportProblems([report]);
        }

        restoreSnapshot(prepared.snapshot);
        normalResult = runIncrementExport();
        assertNormalIncrementSucceeded(normalResult);
        assertNoReportProblems(reports);
    } catch (error) {
        caughtError = error;
    } finally {
        restoreSnapshot(originalSnapshot);
        if (fs.existsSync(tempRoot)) fs.rmSync(tempRoot, { recursive: true, force: true });
        writeEvidence(reports, normalResult, prepared, caughtError);
    }

    if (caughtError) throw caughtError;
}

main().catch((error: unknown) => {
    console.error(formatUnknownError(error));
    process.exit(1);
});
