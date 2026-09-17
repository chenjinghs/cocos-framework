import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as xlsx from "xlsx";

import {
    DataTableSchema,
    DataWithSchema,
    EFieldType,
    FilePathData,
    Loader,
    OutputData,
    Processor,
    TaggedInfoExtraData,
    addLocalizationFile,
    createDefaultGlobalConfig,
    formatLoc,
    parseLocalizationConfig,
    setGlobalConfig,
    stacktrace,
} from "../src/new";
import { convertExcelToCsv } from "../src/new/misc/ExcelToCsv";

function createTempDir(name: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function initConfig(): void {
    const config = createDefaultGlobalConfig();
    setGlobalConfig(config);
    parseLocalizationConfig(config.localization);
}

async function createOutput(name: string, fields: Array<Record<string, unknown>>, data: object) {
    initConfig();
    const schema = new DataTableSchema();
    schema.config = {
        type: "data-table",
        name,
        fields,
    };
    schema.source = new FilePathData(`${name}.csv`, "hash");
    schema.schemaFiles = [`${name}.yml`];
    await schema.generateFields();
    return new DataWithSchema(data, schema);
}

async function runPostProcess(outputs: DataWithSchema[]) {
    const processor = Processor.create("PostProcess");
    assert.ok(processor);
    processor.config = {
        type: "PostProcess",
        description: "test post process",
    };
    return processor.processAll(outputs);
}

test("Loader reads yaml, text, ini, tab, csv, xlsx, cache, default fallback, and wraps load errors", async () => {
    initConfig();
    const root = createTempDir("k-export-flow-loader-");
    const yamlFile = path.join(root, "demo.yml");
    const textFile = path.join(root, "demo.txt");
    const iniFile = path.join(root, "demo.ini");
    const tabFile = path.join(root, "demo.tab");
    const csvFile = path.join(root, "demo.csv");
    const unknownFile = path.join(root, "demo.unknown");
    const xlsxFile = path.join(root, "demo.xlsx");
    const badYamlFile = path.join(root, "bad.yml");

    fs.writeFileSync(yamlFile, "name: demo\nitems:\n  - 1\n", "utf8");
    fs.writeFileSync(textFile, "plain text", "utf8");
    fs.writeFileSync(iniFile, "a=1\nb=2", "utf8");
    fs.writeFileSync(tabFile, "id\tname\n1\talpha\n\t\n2\tbeta\\nline\n", "utf8");
    fs.writeFileSync(csvFile, "id,name\n1,alpha\n", "utf8");
    fs.writeFileSync(unknownFile, "fallback", "utf8");
    fs.writeFileSync(badYamlFile, "name: [\n", "utf8");

    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, xlsx.utils.aoa_to_sheet([
        ["id", "value"],
        [1, 2],
    ]), "Sheet1");
    xlsx.writeFile(workbook, xlsxFile);

    assert.deepEqual(await Loader.create(".yml")?.loadRawDataObject(yamlFile, {}), { name: "demo", items: [1] });
    assert.equal(await Loader.create(".txt")?.loadRawDataObject(textFile, {}), "plain text");
    assert.deepEqual(await Loader.create(".ini")?.loadRawDataObject(iniFile, {}), [["a", "1"], ["b", "2"]]);
    assert.deepEqual(await Loader.create(".tab")?.loadRawDataObject(tabFile, {}), [["id", "name"], ["1", "alpha"], ["2", "beta\nline"]]);
    assert.deepEqual(await Loader.create(".csv")?.loadRawDataObject(csvFile, {}), [["id", "name"], ["1", "alpha"]]);
    assert.deepEqual(await Loader.create(".xlsx")?.loadRawDataObject(xlsxFile, { sheet: "Sheet1" }), [["id", "value"], [1, 2]]);
    assert.equal(await Loader.create(".unknown")?.loadRawDataObject(unknownFile, {}), "fallback");
    assert.equal(Loader.create(".unknown", false), undefined);

    const tabLoader = Loader.create(".tab") as any;
    assert.deepEqual(tabLoader.removeEmptyValues([[" ", "kept"], [" ", " "]]), [[undefined, "kept"]]);

    await assert.rejects(
        () => Loader.create(".yml")!.loadRawDataObject(badYamlFile, {}),
        /load-raw-data-failed|加载 yml 文件失败/,
    );

    fs.rmSync(root, { recursive: true, force: true });
});

test("convertExcelToCsv clears targets, skips temp workbooks, and deletes stale missing-source csv files", async () => {
    const root = createTempDir("k-export-flow-excel-edge-");
    const sourceRoot = path.join(root, "xlsx");
    const targetRoot = path.join(root, "csv");
    const cacheRoot = path.join(root, "cache");
    fs.mkdirSync(sourceRoot, { recursive: true });
    fs.mkdirSync(targetRoot, { recursive: true });
    fs.mkdirSync(cacheRoot, { recursive: true });
    fs.writeFileSync(path.join(targetRoot, "stale.csv"), "old", "utf8");

    const logs: string[] = [];
    const cleared = await convertExcelToCsv({
        sourceFiles: [],
        sourceBaseDir: sourceRoot,
        targetBaseDir: targetRoot,
        replaceNameString: [],
        outputLog: true,
        logger: (message) => logs.push(message),
        clearTargetFiles: true,
        incrementBuildInfoPath: cacheRoot,
    });
    assert.equal(fs.existsSync(path.join(targetRoot, "stale.csv")), false);
    assert.equal(cleared.incrementBuildInfo?.size, 0);
    assert.equal(cleared.incrementBuildInfoPath, cacheRoot);

    const missingSource = path.join(sourceRoot, "OldName.xlsx");
    const tempSource = path.join(sourceRoot, "~$Temp.xlsx");
    const staleTarget = path.join(targetRoot, "NewName.csv");
    fs.writeFileSync(staleTarget, "stale", "utf8");

    const missingResult = await convertExcelToCsv({
        sourceFiles: [missingSource, tempSource],
        sourceBaseDir: sourceRoot,
        targetBaseDir: targetRoot,
        replaceNameString: [["Old", "New"]],
        outputLog: true,
        logger: (message) => logs.push(message),
        incrementBuild: true,
        incrementBuildInfoPath: cacheRoot,
    });

    assert.equal(fs.existsSync(staleTarget), false);
    assert.equal(missingResult.incrementBuildInfo?.size, 0);
    assert.match(logs.join("\n"), /clear target files|delete .*NewName\.csv|0 files changed/);

    fs.rmSync(root, { recursive: true, force: true });
});

test("TS data post processors export number key info, template groups, and field arrays", async () => {
    const output = await createOutput("CodexTSPostProcess", [
        { name: "id", type: EFieldType.Int },
        { name: "group", type: EFieldType.String },
        { name: "weight", type: EFieldType.Int },
    ], new Map<number, Record<string, unknown>>([
        [1, { id: 1, group: "front", weight: 10 }],
        [2, { id: 2, group: "front", weight: 0 }],
        [3, { id: 3, group: "back", weight: 5 }],
    ]));

    output.schema.config.additionalDataPostProcessList = [
        {
            key: "exportNumberKeyInfo",
            config: {
                exportMinKey: true,
                exportMaxKey: true,
                exportKeyCount: true,
                startKey: 1,
                checkContinuous: true,
            },
        },
        { key: "ExportTemplateGroup", config: { groupKeyAlias: "group" } },
        { key: "ExportFiledToArray", config: { filed: "weight", exportedName: "WEIGHTS", filterNotValid: true } },
    ];

    await runPostProcess([output]);

    const infos = output.extraData
        .filter((item): item is TaggedInfoExtraData => item instanceof TaggedInfoExtraData)
        .flatMap((item) => item.infos);

    assert.match(infos.join("\n"), /export const MIN_KEY = 1;/);
    assert.match(infos.join("\n"), /export const MAX_KEY = 3;/);
    assert.match(infos.join("\n"), /export const KEY_COUNT = 3;/);
    assert.match(infos.join("\n"), /\["front", \[1, 2\]\]/);
    assert.match(infos.join("\n"), /getTemplateGroup\(groupId: string\)/);
    assert.match(infos.join("\n"), /export const WEIGHTS = \[10, 5\];/);
});

test("TS data post processors cover bigint and invalid number-key branches", async () => {
    const bigintOutput = await createOutput("CodexBigIntGroupPostProcess", [
        { name: "id", type: EFieldType.Int },
        { name: "group", type: EFieldType.BigInt },
    ], new Map<number, Record<string, unknown>>([
        [1, { id: 1, group: 9n }],
    ]));
    bigintOutput.schema.config.additionalDataPostProcess = {
        key: "ExportTemplateGroup",
        config: { groupKeyAlias: "group" },
    };

    const badKeyOutput = await createOutput("CodexBadNumberKeyPostProcess", [], new Map<string, object>([
        ["bad", {}],
    ]));
    badKeyOutput.schema.config.additionalDataPostProcess = {
        key: "exportNumberKeyInfo",
        config: { exportMinKey: true },
    };

    await runPostProcess([bigintOutput, badKeyOutput]);

    const bigintInfo = bigintOutput.extraData
        .filter((item): item is TaggedInfoExtraData => item instanceof TaggedInfoExtraData)
        .flatMap((item) => item.infos)
        .join("\n");
    assert.match(bigintInfo, /getTemplateGroup\(groupId: bigint\)/);
    assert.equal(badKeyOutput.extraData.length, 0);
});

test("TS data post processors ignore empty inputs and report invalid configs", async () => {
    const emptyNumberOutput = await createOutput("CodexEmptyNumberPostProcess", [], undefined as any);
    emptyNumberOutput.schema.config.additionalDataPostProcess = {
        key: "exportNumberKeyInfo",
    };

    const nonMapGroupOutput = await createOutput("CodexNonMapGroupPostProcess", [
        { name: "group", type: EFieldType.String },
    ], { group: "x" });
    nonMapGroupOutput.schema.config.additionalDataPostProcess = {
        key: "ExportTemplateGroup",
        config: { groupKeyAlias: "group" },
    };

    const noGroupsOutput = await createOutput("CodexNoGroupsPostProcess", [
        { name: "id", type: EFieldType.Int },
        { name: "group", type: EFieldType.String },
    ], new Map<number, Record<string, unknown>>([
        [1, { id: 1, group: "" }],
    ]));
    noGroupsOutput.schema.config.additionalDataPostProcess = {
        key: "ExportTemplateGroup",
        config: { groupKeyAlias: "group" },
    };

    const badGroupTypeOutput = await createOutput("CodexBadGroupTypePostProcess", [
        { name: "id", type: EFieldType.Int },
        { name: "group", type: EFieldType.Bool },
    ], new Map<number, Record<string, unknown>>([
        [1, { id: 1, group: true }],
    ]));
    badGroupTypeOutput.schema.config.additionalDataPostProcess = {
        key: "ExportTemplateGroup",
        config: { groupKeyAlias: "group" },
    };

    const missingArrayConfigOutput = await createOutput("CodexMissingArrayConfigPostProcess", [
        { name: "id", type: EFieldType.Int },
    ], new Map<number, Record<string, unknown>>([[1, { id: 1 }]]));
    missingArrayConfigOutput.schema.config.additionalDataPostProcess = {
        key: "ExportFiledToArray",
    };

    const validOutputs = await runPostProcess([emptyNumberOutput, nonMapGroupOutput, noGroupsOutput]);
    assert.equal(validOutputs.length, 3);
    assert.equal(emptyNumberOutput.extraData.length, 0);
    assert.equal(nonMapGroupOutput.extraData.length, 0);
    assert.equal(noGroupsOutput.extraData.length, 0);

    assert.deepEqual(await runPostProcess([badGroupTypeOutput]), []);
    assert.deepEqual(await runPostProcess([missingArrayConfigOutput]), []);
});

test("localization helpers load additional files, reject duplicates, and expose stack traces", () => {
    initConfig();
    const root = createTempDir("k-export-flow-loc-");
    const extraFile = path.join(root, "extra-loc.json");
    const duplicateFile = path.join(root, "duplicate-loc.json");
    fs.writeFileSync(extraFile, JSON.stringify({ "codex-extra": "hello {name}" }), "utf8");
    fs.writeFileSync(duplicateFile, JSON.stringify({ "codex-extra": "override {name}" }), "utf8");

    addLocalizationFile([extraFile]);
    assert.equal(formatLoc("codex-extra", { name: "tester" }), "hello tester");
    assert.throws(() => addLocalizationFile([duplicateFile]), /duplicated key codex-extra/);
    addLocalizationFile([duplicateFile], true);
    assert.equal(formatLoc("codex-extra", { name: "tester" }), "override tester");
    assert.throws(() => addLocalizationFile([path.join(root, "missing.json")]), /can not load localization file/);
    assert.match(stacktrace(0, 1), /StacktraceError/);
    parseLocalizationConfig();

    fs.rmSync(root, { recursive: true, force: true });
});

class CodexConcurrentAppendProcessor extends Processor<CodexConcurrentAppendProcessor> {
    public inputDataType = OutputData;
    public outputDataType = OutputData;

    protected processSingle(data: OutputData) {
        (data.data as string[]).push(this.getConfig<{ label: string }>().label);
        return data;
    }
}
CodexConcurrentAppendProcessor.register();

class CodexConcurrentFailProcessor extends Processor<CodexConcurrentFailProcessor> {
    public inputDataType = OutputData;
    public outputDataType = OutputData;

    protected processSingle(): OutputData {
        throw new Error("concurrent failed");
    }
}
CodexConcurrentFailProcessor.register();

test("ConcurrentProcessors returns the first processor output and reports sub-processor failures", async () => {
    const data = new OutputData();
    data.data = [] as string[];

    const success = Processor.create("ConcurrentProcessors");
    assert.ok(success);
    success.config = {
        type: "ConcurrentProcessors",
        description: "success",
        processors: [
            { type: "CodexConcurrentAppendProcessor", description: "first", label: "first" },
            { type: "CodexConcurrentAppendProcessor", description: "second", label: "second" },
        ],
    };
    success.onCreate();

    const successResult = await success.processAll([data]);
    assert.deepEqual(successResult, [data]);
    assert.deepEqual((data.data as string[]).sort(), ["first", "second"]);
    assert.equal(success.hasErrorOccurred(), false);

    const failed = Processor.create("ConcurrentProcessors");
    assert.ok(failed);
    failed.config = {
        type: "ConcurrentProcessors",
        description: "failed",
        processors: [
            { type: "CodexConcurrentAppendProcessor", description: "first", label: "kept" },
            { type: "CodexConcurrentFailProcessor", description: "boom" },
        ],
    };
    failed.onCreate();

    assert.deepEqual(await failed.processAll([data]), []);
    assert.equal(failed.hasErrorOccurred(), true);
    assert.equal(failed.getLastError(), "concurrent failed");
});

test("CollectTaggedInfoFromFile reads tagged blocks and reports malformed blocks", async () => {
    initConfig();
    const root = createTempDir("k-export-flow-tagged-");
    const goodFile = path.join(root, "CodexTagged.ts");
    const badFile = path.join(root, "CodexBadTagged.ts");
    fs.writeFileSync(goodFile, [
        "before",
        "// [EXPORT_BEGIN]",
        "export const A = 1;",
        "export const B = 2;",
        "// [EXPORT_END]",
    ].join("\n"), "utf8");
    fs.writeFileSync(badFile, [
        "// [EXPORT_BEGIN]",
        "// [EXPORT_BEGIN]",
    ].join("\n"), "utf8");

    const output = await createOutput("CodexTagged", [], {});
    const processor = Processor.create("CollectTaggedInfoFromFile");
    assert.ok(processor);
    processor.config = {
        type: "CollectTaggedInfoFromFile",
        description: "tagged",
        mappingFileKeyInSchema: "name",
        targetMapping: {
            type: "FindWithBaseName",
            targetDir: root,
        },
    };
    processor.onCreate();

    const result = await processor.processAll([output]);
    assert.deepEqual(result, [output]);
    const info = output.getExtraData(TaggedInfoExtraData);
    assert.deepEqual(info?.infos, ["export const A = 1;", "export const B = 2;"]);

    const badOutput = await createOutput("CodexBadTagged", [], {});
    assert.deepEqual(await processor.processAll([badOutput]), []);
    assert.equal(processor.hasErrorOccurred(), true);

    fs.rmSync(root, { recursive: true, force: true });
});
