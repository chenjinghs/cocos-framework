import test from "node:test";
import assert from "node:assert/strict";
import * as xlsx from "xlsx";
import { sheetToCsv } from "../src/new/misc/SheetToCsv";

test("sheetToCsv keeps Excel date serial aligned with ExcelJS output", () => {
    const ws: xlsx.WorkSheet = {
        "!ref": "A1:A1",
        A1: { t: "n", v: 45717, z: "m/d/yy", w: "3/1/25" },
    };

    assert.equal(sheetToCsv(ws), '"""2025-03-01T00:00:00.000Z"""');
});
