import * as path from "path";

import { ExportLogger } from "./ExportLogger";

export enum ExportOutputFileType {
    Json = "JSON",
    Lua = "Lua",
    TypeScriptDataTable = "TypeScript data-table",
    TypeScriptIni = "TypeScript ini",
    OtherBusinessOutput = "Other business output",
}

export enum ExportOutputChangeType {
    Added = "Added",
    Modified = "Modified",
    Deleted = "Deleted",
}

export interface IExportOutputClassification {
    type: ExportOutputFileType;
    path: string;
    isBusinessOutput: boolean;
}

export interface IExportOutputChangeInfo extends IExportOutputClassification {
    changeType: ExportOutputChangeType;
}

export type ExportRunStatsSummary = Record<ExportOutputFileType, Record<ExportOutputChangeType, string[]>>;

interface IExportOutputEntry {
    changeType: ExportOutputChangeType;
    classification: IExportOutputClassification;
}

const REPOSITORY_PREFIX = "ResProject/";
const JSON_OUTPUT_PREFIX = "TempSaved/export-flow/output/client/config/";
const LUA_OUTPUT_PREFIX = "LuaScripts/DataCenter/NewConfig/";
const TS_DATA_TABLE_OUTPUT_PREFIX = "TypeScripts/packages/client/src/generated/data-table/";
const TS_INI_OUTPUT_PREFIX = "TypeScripts/packages/client/src/generated/ini/";
const INTERMEDIATE_DIRECTORIES = [
    "TempSaved/export-flow/csv/",
    "TempSaved/export-flow/raw-data-cache/",
];
const INTERMEDIATE_FILES = new Set([
    "export-csv-increment-info.json",
    "filter-changed-schema.json",
    "early-filter-file-path-data-info.json",
    "filter-changed-file-path-data-info.json",
    "yaml-cache.json",
]);

function createEmptyChangeSummary() {
    return {
        [ExportOutputChangeType.Added]: new Array<string>(),
        [ExportOutputChangeType.Modified]: new Array<string>(),
        [ExportOutputChangeType.Deleted]: new Array<string>(),
    };
}

function createEmptySummary(): ExportRunStatsSummary {
    return {
        [ExportOutputFileType.Json]: createEmptyChangeSummary(),
        [ExportOutputFileType.Lua]: createEmptyChangeSummary(),
        [ExportOutputFileType.TypeScriptDataTable]: createEmptyChangeSummary(),
        [ExportOutputFileType.TypeScriptIni]: createEmptyChangeSummary(),
        [ExportOutputFileType.OtherBusinessOutput]: createEmptyChangeSummary(),
    };
}

export function normalizeExportPath(filePath: string, rootPath?: string) {
    let normalizedPath = filePath.replaceAll("\\", "/");
    let normalizedRootPath = rootPath?.replaceAll("\\", "/");

    if (normalizedRootPath) {
        normalizedRootPath = normalizedRootPath.replace(/\/+$/, "");
        if (normalizedPath === normalizedRootPath) normalizedPath = "";
        else if (normalizedPath.startsWith(`${normalizedRootPath}/`)) normalizedPath = normalizedPath.slice(normalizedRootPath.length + 1);
    }

    let prefixIndex = normalizedPath.indexOf(REPOSITORY_PREFIX);
    if (prefixIndex >= 0) normalizedPath = normalizedPath.slice(prefixIndex + REPOSITORY_PREFIX.length);

    while (normalizedPath.startsWith("./")) normalizedPath = normalizedPath.slice(2);
    return normalizedPath;
}

export function classifyExportOutputPath(filePath: string, rootPath?: string): IExportOutputClassification | undefined {
    let normalizedPath = normalizeExportPath(filePath, rootPath);
    if (!normalizedPath || isIntermediateExportPath(normalizedPath)) return undefined;

    let type: ExportOutputFileType;
    if (normalizedPath.startsWith(JSON_OUTPUT_PREFIX) && normalizedPath.endsWith(".json")) type = ExportOutputFileType.Json;
    else if (normalizedPath.startsWith(LUA_OUTPUT_PREFIX) && normalizedPath.endsWith(".lua")) type = ExportOutputFileType.Lua;
    else if (normalizedPath.startsWith(TS_DATA_TABLE_OUTPUT_PREFIX) && normalizedPath.endsWith(".ts")) type = ExportOutputFileType.TypeScriptDataTable;
    else if (normalizedPath.startsWith(TS_INI_OUTPUT_PREFIX) && normalizedPath.endsWith(".ts")) type = ExportOutputFileType.TypeScriptIni;
    else type = ExportOutputFileType.OtherBusinessOutput;

    return {
        type: type,
        path: normalizedPath,
        isBusinessOutput: true,
    };
}

function isIntermediateExportPath(normalizedPath: string) {
    for (let directory of INTERMEDIATE_DIRECTORIES) {
        if (normalizedPath.startsWith(directory)) return true;
    }

    return INTERMEDIATE_FILES.has(path.basename(normalizedPath));
}

export class ExportRunStats {
    private static instance = new ExportRunStats();

    public static getInstance() {
        return this.instance;
    }

    public static resetInstance(rootPath?: string) {
        this.instance = new ExportRunStats(rootPath);
        return this.instance;
    }

    private readonly changes = new Map<string, IExportOutputEntry>();

    public constructor(private rootPath?: string) {}

    public setRootPath(rootPath?: string) {
        this.rootPath = rootPath;
    }

    public recordAdded(filePath: string) {
        this.record(filePath, ExportOutputChangeType.Added);
    }

    public recordModified(filePath: string) {
        this.record(filePath, ExportOutputChangeType.Modified);
    }

    public recordDeleted(filePath: string) {
        this.record(filePath, ExportOutputChangeType.Deleted);
    }

    public getSummary() {
        let summary = createEmptySummary();
        for (let entry of this.changes.values()) {
            summary[entry.classification.type][entry.changeType].push(entry.classification.path);
        }

        for (let typeSummary of Object.values(summary)) {
            for (let paths of Object.values(typeSummary)) paths.sort();
        }

        return summary;
    }

    public getChanges() {
        let ret = new Array<IExportOutputChangeInfo>();
        for (let entry of this.changes.values()) {
            ret.push({
                ...entry.classification,
                changeType: entry.changeType,
            });
        }
        return ret.sort((a, b) => a.path.localeCompare(b.path));
    }

    public renderSummary() {
        const changes = this.getChanges();
        const outputLines = ["=== Export Summary ==="];

        if (changes.length === 0) {
            outputLines.push("No output file changes");
            ExportLogger.logKey(outputLines.join("\n"));
            return;
        }

        const TAG: Record<ExportOutputChangeType, string> = {
            [ExportOutputChangeType.Added]: "[A]",
            [ExportOutputChangeType.Modified]: "[M]",
            [ExportOutputChangeType.Deleted]: "[D]",
        };

        for (const change of changes) {
            outputLines.push(`${TAG[change.changeType]} ${change.path}`);
        }

        ExportLogger.logKey(outputLines.join("\n"));
    }

    public clear() {
        this.changes.clear();
    }

    private record(filePath: string, changeType: ExportOutputChangeType) {
        let classification = classifyExportOutputPath(filePath, this.rootPath);
        if (!classification) return;

        this.changes.set(classification.path, {
            changeType: changeType,
            classification: classification,
        });
    }
}
