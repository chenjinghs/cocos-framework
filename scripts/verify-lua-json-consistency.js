"use strict";

const fs = require("fs");
const path = require("path");

function usage() {
    console.error("Usage: node verify-lua-json-consistency.js <lua-file> <json-file> [--max-mismatches=N]");
}

function parseArgs(argv) {
    let positional = [];
    let maxMismatches = 20;

    for (const arg of argv) {
        if (arg.startsWith("--max-mismatches=")) {
            maxMismatches = Number(arg.slice("--max-mismatches=".length));
            continue;
        }
        positional.push(arg);
    }

    if (positional.length !== 2 || Number.isNaN(maxMismatches) || maxMismatches <= 0) {
        usage();
        process.exit(1);
    }

    return {
        luaPath: path.resolve(positional[0]),
        jsonPath: path.resolve(positional[1]),
        maxMismatches,
    };
}

function createLuaTable(id) {
    return {
        id,
        entries: new Map(),
        metatableIndex: undefined,
    };
}

function ensureLuaTable(tables, id) {
    let table = tables.get(id);
    if (table === undefined) {
        table = createLuaTable(id);
        tables.set(id, table);
    }
    return table;
}

function parseLuaString(text) {
    if (text.startsWith("[[") && text.endsWith("]]")) {
        return text.slice(2, -2);
    }

    let quote = text[0];
    if ((quote !== "'" && quote !== "\"") || text[text.length - 1] !== quote) {
        throw new Error(`Unsupported Lua string literal: ${text}`);
    }

    let content = text.slice(1, -1);
    let output = "";

    for (let i = 0; i < content.length; i++) {
        let ch = content[i];
        if (ch !== "\\") {
            output += ch;
            continue;
        }

        i++;
        if (i >= content.length) {
            throw new Error(`Invalid Lua string escape: ${text}`);
        }

        let escaped = content[i];
        switch (escaped) {
            case "\\":
                output += "\\";
                break;
            case "'":
                output += "'";
                break;
            case "\"":
                output += "\"";
                break;
            case "n":
                output += "\n";
                break;
            case "r":
                output += "\r";
                break;
            case "t":
                output += "\t";
                break;
            default:
                output += escaped;
                break;
        }
    }

    return output;
}

function parseLuaValue(rawValue) {
    let value = rawValue.trim().replace(/,$/, "");

    let tableRefMatch = value.match(/^t\[(\d+)\]$/);
    if (tableRefMatch !== null) {
        return { type: "ref", tableIndex: Number(tableRefMatch[1]) };
    }

    if (value === "true") return true;
    if (value === "false") return false;
    if (value === "nil") return null;
    if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) return Number(value);
    if (value.startsWith("'") || value.startsWith("\"") || value.startsWith("[[")) return parseLuaString(value);

    if (value === "newindex" || /^genPairs\(t\[\d+\]\)$/.test(value)) {
        return { type: "ignore" };
    }

    throw new Error(`Unsupported Lua value: ${rawValue}`);
}

function parseBracketKey(rawKey) {
    let key = rawKey.trim();
    if (/^-?\d+(?:\.\d+)?$/.test(key)) return String(Number(key));
    if (key === "true" || key === "false" || key === "nil") return key;
    if (key.startsWith("'") || key.startsWith("\"") || key.startsWith("[[")) return parseLuaString(key);

    throw new Error(`Unsupported Lua key: ${rawKey}`);
}

function setTableEntry(tables, tableIndex, key, value) {
    let table = ensureLuaTable(tables, tableIndex);
    table.entries.set(String(key), value);
}

function parseLuaExport(luaContent) {
    let tables = new Map();
    let metatables = new Map();
    let currentBlock = undefined;
    let rootTableIndex = undefined;
    let afterMetaMarker = false;
    let lines = luaContent.split(/\r?\n/);

    for (let lineNo = 0; lineNo < lines.length; lineNo++) {
        let line = lines[lineNo];
        let trimmed = line.trim();

        if (trimmed.length === 0 || trimmed === "local t = {}" || trimmed.startsWith("--")) {
            continue;
        }

        if (trimmed === "------------------------------ meta table ------------------------------") {
            afterMetaMarker = true;
            continue;
        }

        if (currentBlock !== undefined) {
            if (trimmed === "}") {
                currentBlock = undefined;
                continue;
            }

            if (currentBlock.type === "table") {
                let tableEntryMatch = trimmed.match(/^\[(.+)\]\s*=\s*(.+),?$/);
                if (tableEntryMatch !== null) {
                    setTableEntry(tables, currentBlock.tableIndex, parseBracketKey(tableEntryMatch[1]), parseLuaValue(tableEntryMatch[2]));
                    continue;
                }

                let namedEntryMatch = trimmed.match(/^([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.+),?$/);
                if (namedEntryMatch !== null) {
                    setTableEntry(tables, currentBlock.tableIndex, namedEntryMatch[1], parseLuaValue(namedEntryMatch[2]));
                    continue;
                }
            } else if (currentBlock.type === "metatable") {
                let metaIndexMatch = trimmed.match(/^__index\s*=\s*t\[(\d+)\],?$/);
                if (metaIndexMatch !== null) {
                    metatables.set(currentBlock.metatableName, Number(metaIndexMatch[1]));
                    continue;
                }

                let ignoredMetaMatch = trimmed.match(/^(__newindex|__pairs)\s*=/);
                if (ignoredMetaMatch !== null) {
                    continue;
                }
            }

            throw new Error(`Unsupported line ${lineNo + 1}: ${line}`);
        }

        let tableStartMatch = trimmed.match(/^t\[(\d+)\]\s*=\s*\{$/);
        if (tableStartMatch !== null) {
            let tableIndex = Number(tableStartMatch[1]);
            ensureLuaTable(tables, tableIndex);
            currentBlock = { type: "table", tableIndex };
            continue;
        }

        let metatableStartMatch = trimmed.match(/^local\s+mt_(\d+)\s*=\s*\{$/);
        if (metatableStartMatch !== null) {
            currentBlock = { type: "metatable", metatableName: Number(metatableStartMatch[1]) };
            continue;
        }

        let indexedAssignmentMatch = trimmed.match(/^t\[(\d+)\]\[(.+)\]\s*=\s*(.+)$/);
        if (indexedAssignmentMatch !== null) {
            setTableEntry(
                tables,
                Number(indexedAssignmentMatch[1]),
                parseBracketKey(indexedAssignmentMatch[2]),
                parseLuaValue(indexedAssignmentMatch[3])
            );
            continue;
        }

        let fieldAssignmentMatch = trimmed.match(/^t\[(\d+)\]\.([A-Za-z_][A-Za-z_0-9]*)\s*=\s*(.+)$/);
        if (fieldAssignmentMatch !== null) {
            setTableEntry(tables, Number(fieldAssignmentMatch[1]), fieldAssignmentMatch[2], parseLuaValue(fieldAssignmentMatch[3]));
            continue;
        }

        let setMetatableMatch = trimmed.match(/^setmetatable\(t\[(\d+)\],\s*mt_(\d+)\)$/);
        if (setMetatableMatch !== null) {
            let tableIndex = Number(setMetatableMatch[1]);
            let metatableName = Number(setMetatableMatch[2]);
            let baseTableIndex = metatables.get(metatableName);
            if (baseTableIndex === undefined) {
                throw new Error(`Metatable mt_${metatableName} was not defined before use`);
            }
            ensureLuaTable(tables, tableIndex).metatableIndex = baseTableIndex;
            continue;
        }

        let returnMatch = trimmed.match(/^return\s+t\[(\d+)\]$/);
        if (returnMatch !== null) {
            rootTableIndex = Number(returnMatch[1]);
            continue;
        }

        if (afterMetaMarker) {
            continue;
        }
    }

    if (currentBlock !== undefined) {
        throw new Error("Unexpected EOF while parsing Lua file");
    }
    if (rootTableIndex === undefined) {
        throw new Error("Could not find `return t[...]` in Lua file");
    }

    return { tables, rootTableIndex };
}

function isLuaTableRef(value) {
    return value !== null && typeof value === "object" && value.type === "ref";
}

function getVisibleLuaValue(tables, table, key, visited = new Set()) {
    if (table.entries.has(key)) {
        return table.entries.get(key);
    }

    if (table.metatableIndex === undefined) {
        return undefined;
    }

    if (visited.has(table.id)) {
        return undefined;
    }

    visited.add(table.id);
    let baseTable = tables.get(table.metatableIndex);
    if (baseTable === undefined) {
        return undefined;
    }
    return getVisibleLuaValue(tables, baseTable, key, visited);
}

function collectVisibleLuaKeys(tables, table, keys = new Set(), visited = new Set()) {
    if (visited.has(table.id)) {
        return keys;
    }

    visited.add(table.id);
    for (const key of table.entries.keys()) {
        keys.add(key);
    }

    if (table.metatableIndex !== undefined) {
        let baseTable = tables.get(table.metatableIndex);
        if (baseTable !== undefined) {
            collectVisibleLuaKeys(tables, baseTable, keys, visited);
        }
    }

    return keys;
}

function formatPath(pathText, key, isArrayIndex) {
    if (pathText.length === 0) {
        return isArrayIndex ? `[${key}]` : /^[A-Za-z_][A-Za-z_0-9]*$/.test(key) ? key : `[${JSON.stringify(key)}]`;
    }

    if (isArrayIndex) {
        return `${pathText}[${key}]`;
    }

    return /^[A-Za-z_][A-Za-z_0-9]*$/.test(key) ? `${pathText}.${key}` : `${pathText}[${JSON.stringify(key)}]`;
}

function describeLuaValue(value) {
    if (isLuaTableRef(value)) {
        return `table(t[${value.tableIndex}])`;
    }
    return JSON.stringify(value);
}

function sortLuaKeys(keys) {
    return [...keys].sort((a, b) => {
        let numberA = Number(a);
        let numberB = Number(b);
        let isNumberA = String(numberA) === a;
        let isNumberB = String(numberB) === b;

        if (isNumberA && isNumberB) return numberA - numberB;
        if (isNumberA) return -1;
        if (isNumberB) return 1;
        return a.localeCompare(b);
    });
}

function isDenseLuaArrayKeys(keys) {
    if (keys.length === 0) return true;

    for (let index = 0; index < keys.length; index++) {
        if (keys[index] !== String(index + 1)) {
            return false;
        }
    }
    return true;
}

function materializeLuaValue(tables, value, visited = new Set()) {
    if (!isLuaTableRef(value)) {
        return value;
    }

    if (visited.has(value.tableIndex)) {
        return `[Circular t[${value.tableIndex}]]`;
    }

    let table = tables.get(value.tableIndex);
    if (table === undefined) {
        return `[Missing t[${value.tableIndex}]]`;
    }

    visited.add(value.tableIndex);
    let visibleKeys = sortLuaKeys(collectVisibleLuaKeys(tables, table));
    let result;

    if (isDenseLuaArrayKeys(visibleKeys)) {
        result = visibleKeys.map((key) => materializeLuaValue(tables, getVisibleLuaValue(tables, table, key), visited));
    } else {
        result = {};
        for (const key of visibleKeys) {
            result[key] = materializeLuaValue(tables, getVisibleLuaValue(tables, table, key), visited);
        }
    }

    visited.delete(value.tableIndex);
    return result;
}

function formatLuaMissingContent(tables, value) {
    let content = JSON.stringify(materializeLuaValue(tables, value));
    if (content === undefined) {
        content = String(materializeLuaValue(tables, value));
    }
    if (content.length > 300) {
        content = `${content.slice(0, 297)}...`;
    }
    return content;
}

function compareLuaWithJson(luaValue, expectedValue, pathText, context, pairCache = new WeakMap()) {
    if (context.mismatches.length >= context.maxMismatches) {
        return;
    }

    if (Array.isArray(expectedValue)) {
        if (!isLuaTableRef(luaValue)) {
            context.mismatches.push(`${pathText}: expected array, got ${describeLuaValue(luaValue)}`);
            return;
        }

        let table = context.tables.get(luaValue.tableIndex);
        if (table === undefined) {
            context.mismatches.push(`${pathText}: referenced table t[${luaValue.tableIndex}] does not exist`);
            return;
        }

        let visibleKeys = collectVisibleLuaKeys(context.tables, table);
        let expectedKeys = new Set(expectedValue.map((_, index) => String(index + 1)));

        for (const key of visibleKeys) {
            if (!expectedKeys.has(key)) {
                let missingPath = formatPath(pathText, Number(key) - 1, true);
                let missingValue = getVisibleLuaValue(context.tables, table, key);
                context.mismatches.push(`${missingPath}: exists in Lua but is missing in JSON, value = ${formatLuaMissingContent(context.tables, missingValue)}`);
                if (context.mismatches.length >= context.maxMismatches) return;
            }
        }

        for (let index = 0; index < expectedValue.length; index++) {
            let luaChildValue = getVisibleLuaValue(context.tables, table, String(index + 1));
            if (luaChildValue === undefined) {
                context.mismatches.push(`${formatPath(pathText, index, true)}: missing in Lua data`);
                if (context.mismatches.length >= context.maxMismatches) return;
                continue;
            }
            compareLuaWithJson(luaChildValue, expectedValue[index], formatPath(pathText, index, true), context, pairCache);
            if (context.mismatches.length >= context.maxMismatches) return;
        }
        return;
    }

    if (expectedValue !== null && typeof expectedValue === "object") {
        if (!isLuaTableRef(luaValue)) {
            context.mismatches.push(`${pathText}: expected object, got ${describeLuaValue(luaValue)}`);
            return;
        }

        let table = context.tables.get(luaValue.tableIndex);
        if (table === undefined) {
            context.mismatches.push(`${pathText}: referenced table t[${luaValue.tableIndex}] does not exist`);
            return;
        }

        let cachedLuaIds = pairCache.get(expectedValue);
        if (cachedLuaIds === undefined) {
            cachedLuaIds = new Set();
            pairCache.set(expectedValue, cachedLuaIds);
        } else if (cachedLuaIds.has(table.id)) {
            return;
        }
        cachedLuaIds.add(table.id);

        let visibleKeys = collectVisibleLuaKeys(context.tables, table);
        let expectedKeys = new Set(Object.keys(expectedValue).filter((key) => key !== "__m"));

        for (const key of visibleKeys) {
            if (!expectedKeys.has(key)) {
                let missingPath = formatPath(pathText, key, false);
                let missingValue = getVisibleLuaValue(context.tables, table, key);
                context.mismatches.push(`${missingPath}: exists in Lua but is missing in JSON, value = ${formatLuaMissingContent(context.tables, missingValue)}`);
                if (context.mismatches.length >= context.maxMismatches) return;
            }
        }

        for (const key of expectedKeys) {
            let luaChildValue = getVisibleLuaValue(context.tables, table, key);
            if (luaChildValue === undefined) {
                context.mismatches.push(`${formatPath(pathText, key, false)}: missing in Lua data`);
                if (context.mismatches.length >= context.maxMismatches) return;
                continue;
            }
            compareLuaWithJson(luaChildValue, expectedValue[key], formatPath(pathText, key, false), context, pairCache);
            if (context.mismatches.length >= context.maxMismatches) return;
        }
        return;
    }

    if (isLuaTableRef(luaValue)) {
        context.mismatches.push(`${pathText}: expected ${JSON.stringify(expectedValue)}, got ${describeLuaValue(luaValue)}`);
        return;
    }

    if (!Object.is(luaValue, expectedValue)) {
        context.mismatches.push(`${pathText}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(luaValue)}`);
    }
}

function verify(luaPath, jsonPath, maxMismatches) {
    let luaContent = fs.readFileSync(luaPath, "utf8");
    let jsonContent = fs.readFileSync(jsonPath, "utf8");
    let expectedData = JSON.parse(jsonContent);
    let parsedLua = parseLuaExport(luaContent);
    let mismatches = [];

    compareLuaWithJson(
        { type: "ref", tableIndex: parsedLua.rootTableIndex },
        expectedData,
        "root",
        {
            tables: parsedLua.tables,
            mismatches,
            maxMismatches,
        }
    );

    return mismatches;
}

function main() {
    let { luaPath, jsonPath, maxMismatches } = parseArgs(process.argv.slice(2));
    let mismatches = verify(luaPath, jsonPath, maxMismatches);

    if (mismatches.length === 0) {
        console.log(`OK: ${luaPath} matches ${jsonPath}`);
        return;
    }

    console.error(`Found ${mismatches.length} mismatch(es) between Lua and JSON:`);
    for (const mismatch of mismatches) {
        console.error(`- ${mismatch}`);
    }
    process.exitCode = 1;
}

main();
