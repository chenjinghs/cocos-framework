import * as xlsx from "xlsx";

// SheetJS SSF module for date format detection
const SSF: any = (xlsx as any).SSF;

function isDateFormat(fmt: string | undefined): boolean {
    if (!fmt || !SSF?.is_date) return false;
    try { return SSF.is_date(fmt); } catch { return false; }
}

function oaToDate(oa: number): Date {
    // OA serial -> JS Date using Excel's epoch (1899-12-30 UTC).
    return new Date(Math.round(Date.UTC(1899, 11, 30) + oa * 24 * 60 * 60 * 1000));
}

export function sheetToCsv(ws: xlsx.WorkSheet): string {
    if (!ws["!ref"]) return "";
    expandWorksheetRange(ws);
    const range = xlsx.utils.decode_range(ws["!ref"]);

    // Find actual data bounds — only count cells with non-empty rendered value so that
    // trailing empty columns/rows declared in the xlsx (but containing no data) are excluded.
    let maxDataCol = range.s.c - 1;
    let maxDataRow = range.s.r - 1;
    for (const key of Object.keys(ws)) {
        if (key.charCodeAt(0) === 33 /* '!' */) continue; // skip metadata keys
        const coord = xlsx.utils.decode_cell(key);
        if (coord.r <= range.e.r && coord.c <= range.e.c) {
            const cell = ws[key] as xlsx.CellObject;
            const hasValue =
                cell.t === "b" ||
                cell.t === "e" ||
                (cell.t === "n" && cell.v !== undefined) ||
                (cell.w !== undefined && cell.w !== "") ||
                (cell.v !== undefined && String(cell.v) !== "");
            if (hasValue) {
                if (coord.r > maxDataRow) maxDataRow = coord.r;
                if (coord.c > maxDataCol) maxDataCol = coord.c;
            }
        }
    }
    if (maxDataCol < range.s.c) return "";

    const rows: string[] = [];
    for (let r = range.s.r; r <= maxDataRow; r++) {
        const fields: string[] = [];
        for (let c = range.s.c; c <= maxDataCol; c++) {
            const cell = ws[xlsx.utils.encode_cell({ r, c })];
            let value = "";
            if (cell) {
                if (cell.t === "b") {
                    value = cell.v ? "true" : "false";
                } else if (cell.t === "e") {
                    value = String(cell.w ?? cell.v ?? "");
                } else if (cell.t === "n" && cell.v !== undefined) {
                    if (isDateFormat(cell.z)) {
                        // Match ExcelJS behavior: date-formatted cells return a Date object.
                        // JSON.stringify(date) produces a quoted ISO string, e.g. "1899-12-30T10:00:00.000Z".
                        // Our CSV quoting then wraps it to """1899-12-30T10:00:00.000Z""".
                        value = JSON.stringify(oaToDate(cell.v));
                    } else {
                        // Use raw numeric value (cell.v) not the formatted display (cell.w).
                        // ExcelJS returned raw numbers; cell.w applies number formats (e.g. "8,187" instead of 8187).
                        value = String(cell.v);
                    }
                } else if (cell.w !== undefined) {
                    value = String(cell.w).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
                } else if (cell.v !== undefined) {
                    value = String(cell.v).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
                }
            }
            if (value.includes(",") || value.includes('"') || value.includes("\n") || value.includes("\r")) {
                value = '"' + value.replace(/"/g, '""') + '"';
            }
            fields.push(value);
        }
        // Trim trailing empty fields per row to match ExcelJS behavior
        let last = fields.length - 1;
        while (last >= 0 && fields[last] === "") last--;
        rows.push(fields.slice(0, last + 1).join(","));
    }
    return rows.join("\n");
}

/** SheetJS may preserve a stale !ref after rows are appended in Excel. */
export function expandWorksheetRange(ws: xlsx.WorkSheet): void {
    if (!ws["!ref"]) return;
    const range = xlsx.utils.decode_range(ws["!ref"]);
    for (const key of Object.keys(ws)) {
        if (key.charCodeAt(0) === 33) continue;
        const coord = xlsx.utils.decode_cell(key);
        range.s.r = Math.min(range.s.r, coord.r);
        range.s.c = Math.min(range.s.c, coord.c);
        range.e.r = Math.max(range.e.r, coord.r);
        range.e.c = Math.max(range.e.c, coord.c);
    }
    ws["!ref"] = xlsx.utils.encode_range(range);
}
