import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
    DataPostProcess,
    DataTableSchema,
    DataWithSchema,
    FilePathData,
    JsonFileExtraData,
    Manager,
    PostProcessDependencyRegistry,
    Processor,
} from "../src/new";

function createOutput(name: string, data: object = {}) {
    const schema = new DataTableSchema();
    schema.config = {
        type: "data-table",
        name,
        fields: [],
    };
    schema.source = new FilePathData(`${name}.csv`, "hash");
    schema.schemaFiles = [`${name}.meta.yml`];
    return new DataWithSchema(data, schema);
}

async function runPostProcess(data: DataWithSchema[], config: Record<string, unknown> = {}) {
    const processor = Processor.create("PostProcess");
    assert.ok(processor);
    processor.config = {
        type: "PostProcess",
        description: "test post process",
        ...config,
    };
    return processor.processAll(data);
}

test("PostProcess executes additional handlers before schema-name handlers and filters deleted data", async () => {
    const calls: string[] = [];
    const additionalKey = "CodexAdditionalPostProcess";
    const schemaName = "CodexSchemaNamePostProcess";

    DataPostProcess.registerDataPostProcess(additionalKey, (output, config?: { tag?: string }) => {
        calls.push(`additional:${config?.tag}`);
        (output.data as Record<string, unknown>).fromAdditional = true;
    });
    DataPostProcess.registerDataPostProcess(schemaName, (output) => {
        calls.push(`schema:${output.schema.config.name}`);
        output.toBeDeleted = true;
    });

    const output = createOutput(schemaName, {});
    output.schema.config.additionalDataPostProcessList = [
        { key: additionalKey, config: { tag: "first" } },
        { key: "CodexMissingPostProcess" },
    ];

    const result = await runPostProcess([output]);

    assert.deepEqual(calls, ["additional:first", `schema:${schemaName}`]);
    assert.deepEqual(output.data, { fromAdditional: true });
    assert.deepEqual(result, []);
});

test("PostProcess can disable schema-name handlers and runs all-data handlers by priority", async () => {
    const calls: string[] = [];
    const schemaName = "CodexDisabledSchemaNamePostProcess";
    const singleKey = "CodexSinglePostProcessConfig";

    DataPostProcess.registerDataPostProcess(schemaName, () => {
        calls.push("schema");
    });
    DataPostProcess.registerDataPostProcess(singleKey, (_output, config?: { value?: string }) => {
        calls.push(`single:${config?.value}`);
    });

    const late = (outputs: DataWithSchema[]) => {
        calls.push(`late:${outputs.length}`);
    };
    const early = (outputs: DataWithSchema[]) => {
        calls.push(`early:${outputs.length}`);
    };
    DataPostProcess.registerAllDataPostProcess("CodexAllLatePostProcess", late, 20);
    DataPostProcess.registerAllDataPostProcess("CodexAllEarlyPostProcess", early, -20);

    const output = createOutput(schemaName);
    output.schema.config.additionalDataPostProcess = {
        key: singleKey,
        config: { value: "only" },
    };

    const result = await runPostProcess([output], { useSchemaConfigNameAsKey: false });

    assert.deepEqual(result, [output]);
    assert.equal(calls.includes("schema"), false);
    assert.deepEqual(calls.slice(0, 3), ["single:only", "early:1", "late:1"]);
});

test("PostProcess removes written json files when a single-data handler fails", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-postprocess-"));
    const targetPath = path.join(tmpDir, "broken.json");
    const cacheDir = path.join(tmpDir, "TempSaved/export-flow");
    fs.writeFileSync(targetPath, "{\"stale\":true}", "utf8");
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(path.join(cacheDir, "export-csv-increment-info.json"), JSON.stringify({
        [`${path.join(tmpDir, "CodexFailingSinglePostProcess.xlsx")}`]: { hash: "old", csvFiles: ["CodexFailingSinglePostProcess.csv"] },
        [`${path.join(tmpDir, "Keep.xlsx")}`]: { hash: "keep", csvFiles: ["Keep.csv"] },
    }), "utf8");
    for (const cacheName of [
        "early-filter-file-path-data-info.json",
        "filter-changed-file-path-data-info.json",
        "filter-changed-schema.json",
    ]) {
        fs.writeFileSync(path.join(cacheDir, cacheName), JSON.stringify({
            version: 1,
            data: [
                { path: "CodexFailingSinglePostProcess.csv", hash: "old" },
                { path: "Keep.csv", hash: "keep" },
            ],
        }), "utf8");
    }

    const failingKey = "CodexFailingSinglePostProcess";
    DataPostProcess.registerDataPostProcess(failingKey, () => {
        throw new Error("boom");
    });

    const output = createOutput(failingKey);
    output.addExtraData(new JsonFileExtraData(targetPath));
    (Manager.getInstance() as unknown as { additionalArgs: Map<string, string> }).additionalArgs = new Map([["rootPath", tmpDir]]);

    const result = await runPostProcess([output]);

    assert.deepEqual(result, []);
    assert.equal(fs.existsSync(targetPath), false);
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(cacheDir, "export-csv-increment-info.json"), "utf8"))), [path.join(tmpDir, "Keep.xlsx")]);
    for (const cacheName of [
        "early-filter-file-path-data-info.json",
        "filter-changed-file-path-data-info.json",
        "filter-changed-schema.json",
    ]) {
        const data = JSON.parse(fs.readFileSync(path.join(cacheDir, cacheName), "utf8")).data;
        assert.deepEqual(data, [{ path: "Keep.csv", hash: "keep" }]);
    }

    await Manager.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("PostProcess.callFuncAll: registry gating — csvGroups / readsTables / OR logic control execution", async () => {
    // 验证 callFuncAll 中 registry gating 的 OR 逻辑：
    //   - csvGroups 匹配 → 执行；csvGroups 不匹配 → 跳过
    //   - readsTables 匹配 → 执行；readsTables 不匹配 → 跳过
    //   - csvGroups 不匹配但 readsTables 匹配 → 执行（OR 关系）
    const calls: string[] = [];
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-pp-gating-"));
    const depsFile = path.join(tmpDir, "post-process-deps.yml");
    fs.writeFileSync(depsFile, [
        "version: 1",
        "globalProcessors:",
        "  - name: PP_G1_CsvHit",
        "    csvGroups:",
        "      - name: csv",
        "        includeRegex: [\"hit\\\\.csv$\"]",
        "  - name: PP_G1_CsvMiss",
        "    csvGroups:",
        "      - name: csv",
        "        includeRegex: [\"miss\\\\.csv$\"]",
        "  - name: PP_G1_TableHit",
        "    readsTables: [HitTable]",
        "  - name: PP_G1_TableMiss",
        "    readsTables: [MissTable]",
        "  - name: PP_G1_OrLogic",
        "    csvGroups:",
        "      - name: csv",
        "        includeRegex: [\"nomatch\\\\.csv$\"]",
        "    readsTables: [HitTable]",
    ].join("\n"), "utf8");

    const registry = new PostProcessDependencyRegistry();
    registry.loadYamlDeclarations(depsFile);
    DataPostProcess.setDependencyRegistry(registry);

    try {
        DataPostProcess.registerAllDataPostProcess("PP_G1_CsvHit", () => calls.push("csv-hit"));
        DataPostProcess.registerAllDataPostProcess("PP_G1_CsvMiss", () => calls.push("csv-miss"));
        DataPostProcess.registerAllDataPostProcess("PP_G1_TableHit", () => calls.push("table-hit"));
        DataPostProcess.registerAllDataPostProcess("PP_G1_TableMiss", () => calls.push("table-miss"));
        DataPostProcess.registerAllDataPostProcess("PP_G1_OrLogic", () => calls.push("or-logic"));

        // Output: source path "data/hit.csv" → matches PP_G1_CsvHit; schema name "HitTable" → matches PP_G1_TableHit + PP_G1_OrLogic
        const output = createOutput("HitTable");
        output.schema.source = new FilePathData("data/hit.csv", "hash");
        await runPostProcess([output]);
    } finally {
        (DataPostProcess as any).dependencyRegistry = null;
    }

    assert.deepEqual(calls.sort(), ["csv-hit", "or-logic", "table-hit"],
        "csvGroups match, readsTables match, and OR-logic (table match despite csv miss) should all run; others skip");

    await Manager.destroy();
    fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("PostProcess.callFuncAll is skipped when a single-data handler has already failed", async () => {
    // 验证 callFunc 抛错后 hasErrorOccurred() = true，callFuncAll 中的 all-data handler 不执行
    const allDataCalled: boolean[] = [];

    DataPostProcess.registerDataPostProcess("PP_G2_FailSingle", () => {
        throw new Error("intentional failure in single handler");
    });
    DataPostProcess.registerAllDataPostProcess("PP_G2_AllData", () => {
        allDataCalled.push(true);
    });

    const output = createOutput("PP_G2_FailSingle");
    await runPostProcess([output]);  // processAll swallows the error, returns []

    assert.deepEqual(allDataCalled, [],
        "callFuncAll must be skipped when hasErrorOccurred() is true from a prior single-data failure");
});
