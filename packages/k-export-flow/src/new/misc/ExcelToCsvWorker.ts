import { workerData, parentPort } from "worker_threads";
import * as xlsx from "xlsx";
import * as fs from "fs";
import { fastHash } from "./FastHash";
import { expandWorksheetRange, sheetToCsv } from "./SheetToCsv";

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

const FORMULA_CACHE_MISSING_ERROR = "[formula-cache-missing]";

interface XlsxFileEntry {
    content?: Buffer | Uint8Array | string;
}

type WorkbookWithFiles = xlsx.WorkBook & {
    files?: Record<string, XlsxFileEntry>;
};

const { tasks } = workerData as { tasks: WorkerTask[] };
const hashes: Record<string, string> = Object.create(null);
let converted = 0;
const errors: Array<{ file: string; error: string }> = [];

function xmlContent(file: XlsxFileEntry | undefined): string | undefined {
    const content = file?.content;
    if (content === undefined) return undefined;
    if (typeof content === "string") return content;
    return Buffer.from(content).toString("utf-8");
}

function decodeXml(value: string): string {
    return value
        .replace(/&quot;/g, "\"")
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
}

function readXmlAttributes(xml: string): Record<string, string> {
    const ret: Record<string, string> = Object.create(null);
    const attrReg = /([A-Za-z_:][A-Za-z0-9_.:-]*)="([^"]*)"/g;
    let match: RegExpExecArray | null;
    while ((match = attrReg.exec(xml)) !== null) ret[match[1]] = decodeXml(match[2]);
    return ret;
}

function stripXmlTags(xml: string): string {
    return decodeXml(xml.replace(/<[^>]+>/g, "")).trim();
}

function hasNonEmptyTagValue(xml: string, tagName: "v" | "is"): boolean {
    const tagReg = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`);
    const match = tagReg.exec(xml);
    return match !== null && stripXmlTags(match[1]).length > 0;
}

function hasTag(xml: string, tagName: "v" | "is"): boolean {
    return new RegExp(`<${tagName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tagName}>`).test(xml);
}

function hasFormulaCacheValue(attrs: Record<string, string>, cellXml: string): boolean {
    if (hasNonEmptyTagValue(cellXml, "v") || hasNonEmptyTagValue(cellXml, "is")) return true;
    // Excel stores a legitimate empty string formula result as t="str" with <v></v>.
    return attrs.t === "str" && hasTag(cellXml, "v");
}

function normalizeXlsxPath(path: string): string {
    return path.replace(/^\/+/, "").replace(/\\/g, "/");
}

function joinXlsxPath(baseDir: string, target: string): string {
    const normalizedTarget = normalizeXlsxPath(target);
    if (normalizedTarget.startsWith("xl/")) return normalizedTarget;
    return normalizeXlsxPath(`${baseDir}/${normalizedTarget}`);
}

function getWorksheetXmlPaths(workbook: WorkbookWithFiles): string[] {
    const files = workbook.files;
    const fallback = workbook.SheetNames.map((_, index) => `xl/worksheets/sheet${index + 1}.xml`);
    if (!files) return fallback;

    const workbookXml = xmlContent(files["xl/workbook.xml"]);
    const relsXml = xmlContent(files["xl/_rels/workbook.xml.rels"]);
    if (!workbookXml || !relsXml) return fallback;

    const rels = new Map<string, string>();
    const relReg = /<Relationship\b([^>]*)\/?>/g;
    let relMatch: RegExpExecArray | null;
    while ((relMatch = relReg.exec(relsXml)) !== null) {
        const attrs = readXmlAttributes(relMatch[1]);
        if (attrs.Id && attrs.Target) rels.set(attrs.Id, joinXlsxPath("xl", attrs.Target));
    }

    const paths: string[] = [];
    const sheetReg = /<sheet\b([^>]*)\/?>/g;
    let sheetMatch: RegExpExecArray | null;
    while ((sheetMatch = sheetReg.exec(workbookXml)) !== null) {
        const attrs = readXmlAttributes(sheetMatch[1]);
        const relId = attrs["r:id"];
        if (relId && rels.has(relId)) paths.push(rels.get(relId)!);
    }

    return paths.length === workbook.SheetNames.length ? paths : fallback;
}

function getMissingFormulaCaches(workbook: WorkbookWithFiles): string[] {
    const missing: string[] = [];
    const files = workbook.files;
    const sheetXmlPaths = getWorksheetXmlPaths(workbook);
    for (let i = 0; i < sheetXmlPaths.length; i++) {
        const sheetName = workbook.SheetNames[i] ?? `Sheet${i + 1}`;
        const xml = xmlContent(files?.[sheetXmlPaths[i]]);
        if (!xml) continue;

        const cellReg = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
        let cellMatch: RegExpExecArray | null;
        while ((cellMatch = cellReg.exec(xml)) !== null) {
            const attrs = readXmlAttributes(cellMatch[1]);
            const cellName = attrs.r;
            const cellXml = cellMatch[2] ?? "";
            if (!cellName || !/<f\b/.test(cellXml)) continue;
            if (!hasFormulaCacheValue(attrs, cellXml)) {
                return [`${sheetName}!${cellName}`];
            }
        }
    }
    return missing;
}

function assertFormulaCacheExists(workbook: WorkbookWithFiles): void {
    const missing = getMissingFormulaCaches(workbook);
    if (missing.length === 0) return;

    throw new Error(`${FORMULA_CACHE_MISSING_ERROR}\n${missing.join("\n")}`);
}

for (const task of tasks) {
    const { sourceFile, targetFile, sheetName, needIgnoreDataAfterEmptyLine, cachedHash } = task;
    try {
        const fileBuffer = fs.readFileSync(sourceFile);
        const hash = fastHash(fileBuffer);
        hashes[sourceFile.replaceAll("\\", "/")] = hash;

        if (cachedHash !== undefined && hash === cachedHash) continue; // unchanged

        const workbook = xlsx.read(fileBuffer, {
            type: "buffer",
            bookDeps: true,
            cellFormula: true,
            bookFiles: true,
            raw: false,
            cellNF: true,
            sheetStubs: true,
        }) as WorkbookWithFiles;
        assertFormulaCacheExists(workbook);
        const targetSheetName = sheetName ?? workbook.SheetNames[0];
        const worksheet = workbook.Sheets[targetSheetName];
        if (!worksheet) continue;

        expandWorksheetRange(worksheet);

        if (needIgnoreDataAfterEmptyLine && worksheet["!ref"]) {
            const range = xlsx.utils.decode_range(worksheet["!ref"]);
            const rowsWithData = new Set<number>();
            for (const key of Object.keys(worksheet)) {
                if (key.charCodeAt(0) !== 33 /* '!' */) rowsWithData.add(xlsx.utils.decode_cell(key).r);
            }
            let truncateAt = -1;
            for (let r = range.s.r; r <= range.e.r; r++) {
                if (!rowsWithData.has(r)) { truncateAt = r; break; }
            }
            if (truncateAt >= 0) {
                worksheet["!ref"] = xlsx.utils.encode_range({ ...range, e: { ...range.e, r: truncateAt - 1 } });
                for (const key of Object.keys(worksheet)) {
                    if (key.charCodeAt(0) === 33 /* '!' */) continue;
                    if (xlsx.utils.decode_cell(key).r >= truncateAt) delete worksheet[key];
                }
            }
        }

        const csvData = sheetToCsv(worksheet);
        fs.writeFileSync(targetFile, csvData, "utf-8");
        converted++;
    } catch (e: any) {
        errors.push({ file: sourceFile, error: e.message });
    }
}

parentPort!.postMessage({ hashes, converted, errors } as WorkerResult);
