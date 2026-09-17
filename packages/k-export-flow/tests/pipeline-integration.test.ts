import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as xlsx from "xlsx";

import { DataTableSchema, DataWithSchema, FilePathData, Manager, Processor } from "../src/new";

function createTempDir(name: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function normalize(file: string): string {
    return file.replace(/\\/g, "/");
}

function writeFile(file: string, content: string): string {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf-8");
    return file;
}

function writeJson(file: string, data: unknown): string {
    return writeFile(file, JSON.stringify(data));
}

async function runPipeline(root: string, pipelineBody: string, args?: Map<string, string>): Promise<unknown[] | undefined> {
    const pipeline = writeFile(path.join(root, "pipeline.yml"), pipelineBody);
    return await Manager.getInstance().run(pipeline, args ?? new Map<string, string>([
        ["rootPath", normalize(root)],
        ["incrementBuild", "true"],
        ["language", "EN_US"],
        ["environment", "dev"],
        ["verbose", "true"],
    ]));
}

test("minimal project pipeline exports json, TypeScript, environment-filtered csv, copied files, and summary", async () => {
    const root = createTempDir("k-export-flow-pipeline-");
    const csvDir = path.join(root, "csv");
    const schemaDir = path.join(root, "schema");
    const jsonDir = path.join(root, "json");
    const tsDir = path.join(root, "ts");
    const tsIniDir = path.join(root, "ts-ini");
    const copyDir = path.join(root, "copied");
    const sourceCopyFile = writeFile(path.join(root, "source", "client_version.txt"), "1.0.0");
    writeFile(path.join(root, "source-dir", "nested", "copied.txt"), "copied-dir");
    writeFile(path.join(copyDir, "delete-me.txt"), "delete-me");
    writeFile(path.join(copyDir, "keep-zone", "keep", "a.txt"), "keep");
    writeFile(path.join(copyDir, "keep-zone", "drop", "b.txt"), "drop");
    writeFile(path.join(copyDir, "env-config", "Hero.csv"), "base");
    writeFile(path.join(copyDir, "env-config", "environment", "dev", "Hero.csv"), "dev");
    writeFile(path.join(copyDir, "env-config", "environment", "qa", "Hero.csv"), "qa");
    writeJson(path.join(root, "path-operation-relative-environment.json"), { dev: ["shared"] });

    writeFile(path.join(csvDir, "Hero.csv"), [
        "id,name,enabled",
        "1,Alpha,true",
        "2,Beta,false",
    ].join("\n"));
    writeFile(path.join(csvDir, "Settings.csv"), [
        "name,value",
        "maxLevel,42",
        "title,Alpha",
    ].join("\n"));
    writeFile(path.join(csvDir, "localization", "ZH_CN", "Text.csv"), "id,text\n1,你好\n");
    writeFile(path.join(csvDir, "localization", "EN_US", "Text.csv"), "id,text\n1,hello\n");
    writeFile(path.join(csvDir, "localization", "JP", "Text.csv"), "id,text\n1,こんにちは\n");
    writeFile(path.join(csvDir, "environment", "dev", "Hero.csv"), [
        "id,name,enabled",
        "1,DevAlpha,true",
    ].join("\n"));
    writeFile(path.join(csvDir, "environment", "qa", "Hero.csv"), [
        "id,name,enabled",
        "1,QaAlpha,true",
    ].join("\n"));
    writeJson(path.join(root, "relative-environment.json"), { dev: ["shared"] });

    writeFile(path.join(schemaDir, "Hero.yml"), [
        "type: data-table",
        "name: Hero",
        "key: id",
        "exportIterateFunc: true",
        "exportTemplateCountToTS: true",
        "fields:",
        "  - name: id",
        "    type: int",
        "  - name: name",
        "    type: string",
        "  - name: enabled",
        "    type: bool",
    ].join("\n"));
    writeFile(path.join(schemaDir, "Settings.yml"), [
        "type: data-table-ini",
        "name: SettingsIni",
        "key: name",
        "value: value",
        "fields:",
        "  - name: maxLevel",
        "    type: int",
        "  - name: title",
        "    type: string",
    ].join("\n"));

    const result = await runPipeline(root, [
        "processors:",
        "  - type: PrepareDir",
        "    paths:",
        `      - "${normalize(jsonDir)}"`,
        `      - "${normalize(tsDir)}"`,
        `      - "${normalize(tsIniDir)}"`,
        `      - "${normalize(copyDir)}"`,
        "  - type: FilterCsvOutput",
        `    csvDir: "${normalize(csvDir)}"`,
        `    environmentRelativeFilePath: "${normalize(path.join(root, "relative-environment.json"))}"`,
        "  - type: CollectFile",
        `    rootPaths: ["${normalize(csvDir)}"]`,
        "    includeExtensions: [.csv]",
        "    includeRegex: /(Hero|Settings)\\.csv$/",
        "  - type: GenerateSchema",
        "    extensions: [.yml]",
        "    targetMapping:",
        "      type: FindWithBaseName",
        `      targetDir: "${normalize(schemaDir)}"`,
        "  - type: GenerateRawData",
        "    cacheMode: true",
        "  - type: SerializeToJson",
        "    outputLog: true",
        "    exportMeta: true",
        "    targetMapping:",
        "      type: GenerateWithBaseName",
        `      baseDir: "${normalize(schemaDir)}"`,
        `      targetDir: "${normalize(jsonDir)}"`,
        "      extension: .json",
        "  - type: ExportJsonDataTableToTypeScript",
        `    targetDir: "${normalize(tsDir)}"`,
        "    supportOldFeatures: true",
        "    exportIterateFunc: true",
        "    outputLog: true",
        "    jsonTargetMapping:",
        "      type: GenerateWithBaseName",
        `      baseDir: "${normalize(schemaDir)}"`,
        "      targetDir: client/config",
        "      resolvePath: false",
        "      checkInBaseDir: true",
        "      extension: .json",
        "  - type: ExportJsonIniToTypeScript",
        `    targetDir: "${normalize(tsIniDir)}"`,
        "    outputLog: true",
        "    jsonTargetMapping:",
        "      type: GenerateWithBaseName",
        `      baseDir: "${normalize(schemaDir)}"`,
        "      targetDir: client/config",
        "      resolvePath: false",
        "      checkInBaseDir: true",
        "      extension: .json",
        "  - type: PathOperation",
        "    operations:",
        "      - type: Copy",
        `        from: "${normalize(sourceCopyFile)}"`,
        `        to: "${normalize(path.join(copyDir, "client_version.txt"))}"`,
        "        isFile: true",
        "      - type: Copy",
        `        from: "${normalize(path.join(root, "source-dir"))}"`,
        `        to: "${normalize(path.join(copyDir, "source-dir-copy"))}"`,
        "      - type: Delete",
        `        path: "${normalize(path.join(copyDir, "delete-me.txt"))}"`,
        "        isFile: true",
        "      - type: Ensure",
        `        path: "${normalize(path.join(copyDir, "ensured"))}"`,
        "      - type: Recreate",
        `        path: "${normalize(path.join(copyDir, "recreated.txt"))}"`,
        "        isFile: true",
        "      - type: DeleteAllExceptInDir",
        `        dir: "${normalize(path.join(copyDir, "keep-zone"))}"`,
        "        excepts: [keep]",
        "      - type: OverrideConfigWithEnv",
        `        configDir: "${normalize(path.join(copyDir, "env-config"))}"`,
        `        envConfigDir: "${normalize(path.join(copyDir, "env-config", "environment"))}"`,
        "        environment: dev",
        `        environmentRelativeFilePath: "${normalize(path.join(root, "path-operation-relative-environment.json"))}"`,
        "  - type: ExportSummary",
        "    ignorePatterns:",
        "      - /ignored-output/",
    ].join("\n"));

    assert.equal(result?.length, 2);
    assert.equal(result?.every((output) => output instanceof DataWithSchema), true);

    const jsonFile = path.join(jsonDir, "Hero.json");
    const iniJsonFile = path.join(jsonDir, "Settings.json");
    const tsFile = path.join(tsDir, "Hero.ts");
    const iniTsFile = path.join(tsIniDir, "SettingsIni.ts");
    const indexFile = path.join(tsDir, "index.ts");
    const iniIndexFile = path.join(tsIniDir, "index.ts");

    const keptLocalizationFiles = [
        path.join(csvDir, "localization", "ZH_CN", "Text.csv"),
        path.join(csvDir, "localization", "EN_US", "Text.csv"),
    ].filter((file) => fs.existsSync(file));
    assert.equal(keptLocalizationFiles.length, 1);
    assert.equal(fs.existsSync(path.join(csvDir, "localization", "JP", "Text.csv")), false);
    assert.equal(fs.existsSync(path.join(csvDir, "environment", "dev", "Hero.csv")), true);
    assert.equal(fs.existsSync(path.join(csvDir, "environment", "qa", "Hero.csv")), false);
    assert.equal(fs.existsSync(path.join(csvDir, "Hero.csv")), false);
    assert.equal(fs.existsSync(jsonFile), true);
    assert.equal(fs.existsSync(iniJsonFile), true);
    assert.equal(fs.existsSync(tsFile), true);
    assert.equal(fs.existsSync(iniTsFile), true);
    assert.equal(fs.existsSync(indexFile), true);
    assert.equal(fs.existsSync(iniIndexFile), true);
    assert.equal(fs.readFileSync(path.join(copyDir, "client_version.txt"), "utf-8"), "1.0.0");
    assert.equal(fs.readFileSync(path.join(copyDir, "source-dir-copy", "nested", "copied.txt"), "utf-8"), "copied-dir");
    assert.equal(fs.existsSync(path.join(copyDir, "delete-me.txt")), false);
    assert.equal(fs.existsSync(path.join(copyDir, "ensured")), true);
    assert.equal(fs.existsSync(path.join(copyDir, "recreated.txt")), true);
    assert.equal(fs.existsSync(path.join(copyDir, "keep-zone", "keep", "a.txt")), true);
    assert.equal(fs.existsSync(path.join(copyDir, "keep-zone", "drop", "b.txt")), false);
    assert.equal(fs.existsSync(path.join(copyDir, "env-config", "environment", "dev", "Hero.csv")), true);
    assert.equal(fs.existsSync(path.join(copyDir, "env-config", "environment", "qa", "Hero.csv")), false);
    assert.equal(fs.existsSync(path.join(copyDir, "env-config", "Hero.csv")), false);

    const json = fs.readFileSync(jsonFile, "utf-8");
    assert.match(json, /DevAlpha/);

    const ts = fs.readFileSync(tsFile, "utf-8");
    assert.match(ts, /export const TEMPLATE_COUNT = 1/);
    assert.match(ts, /export function findTemplateWithCallback/);
    assert.match(ts, /@deprecated/);
    assert.match(fs.readFileSync(indexFile, "utf-8"), /export \* as Hero from "\.\/Hero";/);
    assert.match(fs.readFileSync(iniJsonFile, "utf-8"), /maxLevel/);
    assert.match(fs.readFileSync(iniTsFile, "utf-8"), /generateJsonIniWrapper/);
    assert.match(fs.readFileSync(iniTsFile, "utf-8"), /export function getTemplate/);
    assert.match(fs.readFileSync(iniIndexFile, "utf-8"), /export \* as SettingsIni from "\.\/SettingsIni";/);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("ConvertExcelToCsv converts a minimal workbook and skips unchanged files in incremental mode", async () => {
    const root = createTempDir("k-export-flow-xlsx-");
    const sourceDir = path.join(root, "excel");
    const csvDir = path.join(root, "csv");
    const tempDir = path.join(root, "temp");
    const workbookPath = path.join(sourceDir, "Hero.xlsx");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });

    const workbook = xlsx.utils.book_new();
    const sheet = xlsx.utils.aoa_to_sheet([
        ["id", "name", "enabled", "formula", "cached"],
        [1, "Alpha", true, { t: "s", f: "\"item_\"&A2", v: "item_1" }, { t: "s", f: "DISPIMG(\"ID_TEST\",1)", v: "=DISPIMG(\"ID_TEST\",1)" }],
        [2, "Beta", false, { t: "s", f: "\"item_\"&A3", v: "item_2" }, { t: "n", f: "VLOOKUP(D3,[1]养成!$A$28:$B$78,2,0)", v: 7 }],
    ]);
    xlsx.utils.book_append_sheet(workbook, sheet, "Sheet1");
    xlsx.writeFile(workbook, workbookPath);

    const pipeline = [
        "processors:",
        "  - type: ConvertExcelToCsv",
        `    sourceBaseDir: "${normalize(sourceDir)}"`,
        `    targetBaseDir: "${normalize(csvDir)}"`,
        "    pattern: \"**/*.xlsx\"",
        `    incrementBuildInfoPath: "${normalize(tempDir)}"`,
        "    outputLog: true",
        "    concurrency: 1",
    ].join("\n");

    await runPipeline(root, pipeline);
    await Manager.getInstance().flushPendingCacheWrites();

    const csvFile = path.join(csvDir, "Hero.csv");
    assert.equal(fs.existsSync(csvFile), true);
    assert.match(fs.readFileSync(csvFile, "utf-8"), /Alpha/);
    assert.match(fs.readFileSync(csvFile, "utf-8"), /item_1/);
    assert.match(fs.readFileSync(csvFile, "utf-8"), /item_2/);
    assert.match(fs.readFileSync(csvFile, "utf-8"), /DISPIMG\(""ID_TEST"",1\)/);
    assert.match(fs.readFileSync(csvFile, "utf-8"), /Beta,false,item_2,7/);
    const firstContent = fs.readFileSync(csvFile, "utf-8");

    await Manager.destroy();
    await runPipeline(root, pipeline);
    await Manager.getInstance().flushPendingCacheWrites();
    assert.equal(fs.readFileSync(csvFile, "utf-8"), firstContent);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("ConvertExcelToCsv reports formula cells without cached values", async () => {
    const root = createTempDir("k-export-flow-xlsx-missing-cache-");
    const sourceDir = path.join(root, "excel");
    const csvDir = path.join(root, "csv");
    const tempDir = path.join(root, "temp");
    const workbookPath = path.join(sourceDir, "Hero.xlsx");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });

    const workbook = xlsx.utils.book_new();
    const sheet = xlsx.utils.aoa_to_sheet([
        ["id", "formula"],
        [1, { t: "z", f: "\"item_\"&A2" }],
    ]);
    xlsx.utils.book_append_sheet(workbook, sheet, "Sheet1");
    xlsx.writeFile(workbook, workbookPath);

    const pipeline = [
        "processors:",
        "  - type: ConvertExcelToCsv",
        `    sourceBaseDir: "${normalize(sourceDir)}"`,
        `    targetBaseDir: "${normalize(csvDir)}"`,
        "    pattern: \"**/*.xlsx\"",
        `    incrementBuildInfoPath: "${normalize(tempDir)}"`,
        "    outputLog: true",
        "    concurrency: 1",
    ].join("\n");

    await assert.rejects(
        () => runPipeline(root, pipeline),
        /以下 Excel 公式缺少缓存值，请打开并保存后重试/
    );

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("PathOperation and FilterCsvOutput cover skip and edge branches", async () => {
    const root = createTempDir("k-export-flow-path-filter-edge-");
    const pathDir = path.join(root, "path-op");
    const csvDir = path.join(root, "csv");
    writeFile(path.join(pathDir, "keep-zone", "keep", "a.txt"), "keep");
    writeFile(path.join(pathDir, "keep-zone", "drop", "b.txt"), "drop");
    writeFile(path.join(pathDir, "no-except", "drop", "b.txt"), "drop");
    writeFile(path.join(pathDir, "env-config", "Hero.csv"), "base");
    writeFile(path.join(pathDir, "env-config", "environment", "qa", "Hero.csv"), "qa");
    writeFile(path.join(csvDir, "localization", "ZH_CN", "Text.csv"), "zh");
    writeFile(path.join(csvDir, "localization", "JP", "Text.csv"), "jp");
    writeFile(path.join(csvDir, "environment", "qa", "Hero.csv"), "qa");
    writeFile(path.join(csvDir, "Hero.csv"), "base");

    await runPipeline(root, [
        "processors:",
        "  - type: PathOperation",
        "    operations:",
        "      - type: Delete",
        `        path: "${normalize(path.join(pathDir, "missing.txt"))}"`,
        "        isFile: true",
        "      - type: Recreate",
        `        path: "${normalize(path.join(pathDir, "recreated-dir"))}"`,
        "      - type: Ensure",
        `        path: "${normalize(path.join(pathDir, "ensured-file.txt"))}"`,
        "        isFile: true",
        "      - type: DeleteAllExceptInDir",
        `        dir: "${normalize(path.join(pathDir, "keep-zone"))}"`,
        "        except: keep",
        "      - type: DeleteAllExceptInDir",
        `        dir: "${normalize(path.join(pathDir, "no-except"))}"`,
        "        except: absent",
        "      - type: OverrideConfigWithEnv",
        `        configDir: "${normalize(path.join(pathDir, "missing-env-config"))}"`,
        `        envConfigDir: "${normalize(path.join(pathDir, "missing-env-config", "environment"))}"`,
        "        environment: dev",
        "      - type: OverrideConfigWithEnv",
        `        configDir: "${normalize(path.join(pathDir, "env-config"))}"`,
        `        envConfigDir: "${normalize(path.join(pathDir, "env-config", "environment"))}"`,
        "        environment: dev",
        `        environmentRelativeFilePath: "${normalize(path.join(root, "missing-relative.json"))}"`,
        "  - type: FilterCsvOutput",
        `    csvDir: "${normalize(csvDir)}"`,
        `    environmentRelativeFilePath: "${normalize(path.join(root, "missing-filter-relative.json"))}"`,
    ].join("\n"), new Map<string, string>([
        ["rootPath", normalize(root)],
        ["incrementBuild", "true"],
        ["environment", "dev"],
    ]));

    assert.equal(fs.existsSync(path.join(pathDir, "recreated-dir")), true);
    assert.equal(fs.existsSync(path.join(pathDir, "ensured-file.txt")), true);
    assert.equal(fs.existsSync(path.join(pathDir, "keep-zone", "keep", "a.txt")), true);
    assert.equal(fs.existsSync(path.join(pathDir, "keep-zone", "drop", "b.txt")), false);
    assert.equal(fs.existsSync(path.join(pathDir, "no-except", "drop", "b.txt")), true);
    assert.equal(fs.existsSync(path.join(pathDir, "env-config", "Hero.csv")), true);
    assert.equal(fs.existsSync(path.join(csvDir, "localization", "JP", "Text.csv")), true);
    assert.equal(fs.existsSync(path.join(csvDir, "environment", "qa", "Hero.csv")), true);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("PrepareDir recreates directories in full build and SerializeToJson skips empty data", async () => {
    const root = createTempDir("k-export-flow-small-processors-");
    const preparedDir = path.join(root, "prepared");
    writeFile(path.join(preparedDir, "stale.txt"), "stale");

    await runPipeline(root, [
        "processors:",
        "  - type: PrepareDir",
        "    paths:",
        `      - "${normalize(preparedDir)}"`,
    ].join("\n"), new Map<string, string>([
        ["rootPath", normalize(root)],
        ["incrementBuild", "false"],
        ["verbose", "true"],
    ]));

    assert.equal(fs.existsSync(preparedDir), true);
    assert.equal(fs.existsSync(path.join(preparedDir, "stale.txt")), false);

    const schema = new DataTableSchema();
    schema.config = {
        type: "data-table",
        name: "CodexEmptyJson",
        fields: [],
    };
    schema.source = new FilePathData("CodexEmptyJson.csv", "hash");
    schema.schemaFiles = [path.join(root, "schema", "CodexEmptyJson.yml")];

    const processor = Processor.create("SerializeToJson");
    assert.ok(processor);
    processor.config = {
        type: "SerializeToJson",
        description: "skip empty output",
        outputLog: true,
        targetMapping: {
            type: "GenerateWithBaseName",
            targetDir: normalize(path.join(root, "json")),
            extension: ".json",
        },
    };
    const output = new DataWithSchema(undefined as unknown as object, schema);
    const result = await processor.processAll([output]);
    assert.deepEqual(result, [output]);
    assert.equal(output.extraData.length, 0);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});
