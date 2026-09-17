import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    DataPostProcess,
    ESchemaDataType,
    ExportLogger,
    ExportOutputChangeType,
    ExportOutputFileType,
    ExportRunStats,
    FilePathData,
    Processor,
    Schema,
    classifyExportOutputPath,
    createDefaultGlobalConfig,
    normalizeExportPath,
    parseLocalizationConfig,
    setGlobalConfig,
} from "../src/new";

function createTempDir(name: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function normalize(file: string): string {
    return file.replace(/\\/g, "/");
}

function writeFile(file: string, content: string): string {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf8");
    return file;
}

function initConfig(): void {
    const config = createDefaultGlobalConfig();
    setGlobalConfig(config);
    parseLocalizationConfig(config.localization);
}

async function runGenerateSchema(root: string, sources: string[], extraConfig: Record<string, unknown> = {}) {
    initConfig();
    const processor = Processor.create("GenerateSchema");
    assert.ok(processor);
    processor.config = {
        type: "GenerateSchema",
        description: "test generate schema",
        extensions: [".yml"],
        targetMapping: {
            type: "FindWithBaseName",
            targetDir: normalize(path.join(root, "schema")),
        },
        ...extraConfig,
    };
    return processor.processAll(sources.map((source) => new FilePathData(source, "hash")));
}

test("GenerateSchema applies aliases, fallback post-process config, disabled post-process, and multiSource names", async () => {
    const root = createTempDir("k-export-flow-generate-schema-");
    const schemaDir = path.join(root, "schema");
    const sourceDir = path.join(root, "csv");
    const sourceA = writeFile(path.join(sourceDir, "CodexAliasA.csv"), "id\n1\n");
    const sourceB = writeFile(path.join(sourceDir, "CodexAliasB.csv"), "id\n1\n");
    const sourceDisabled = writeFile(path.join(sourceDir, "CodexDisabled.csv"), "id\n1\n");
    const sourceMultiA = writeFile(path.join(sourceDir, "CodexMultiA.csv"), "id\n1\n");
    const sourceMultiB = writeFile(path.join(sourceDir, "CodexMultiB.csv"), "id\n1\n");

    writeFile(path.join(schemaDir, "BaseAlias.yml"), [
        "type: data-table",
        "name: BaseAlias",
        "fields:",
        "  - name: id",
        "    type: int",
    ].join("\n"));
    writeFile(path.join(schemaDir, "CodexMultiA.yml"), [
        "type: data-table",
        "name: CodexMulti",
        "multiSource: true",
        "fields:",
        "  - name: id",
        "    type: int",
    ].join("\n"));
    writeFile(path.join(schemaDir, "CodexMultiB.yml"), [
        "type: data-table",
        "name: CodexMulti",
        "multiSource: true",
        "fields:",
        "  - name: id",
        "    type: int",
    ].join("\n"));
    const aliasFile = writeFile(path.join(root, "schema-alias.yml"), [
        "aliases:",
        "  - sourceBaseName: CodexAliasA",
        "    schemaBaseName: BaseAlias",
        "    nameOverride: CodexAliasOverride",
        "  - sourceBaseName: CodexAliasB",
        "    schemaBaseName: BaseAlias",
        "  - sourceBaseName: CodexDisabled",
        "    schemaBaseName: BaseAlias",
        "    disableDataPostProcess: true",
    ].join("\n"));

    const outputs = await runGenerateSchema(root, [
        sourceA,
        sourceB,
        sourceDisabled,
        sourceMultiA,
        sourceMultiB,
    ], { schemaAliasFile: normalize(aliasFile) }) as Schema[];

    const names = outputs.map((schema) => schema.config.name).sort();
    assert.deepEqual(names.slice(0, 3), [
        "BaseAlias_CodexAliasB",
        "BaseAlias_CodexDisabled",
        "CodexAliasOverride",
    ]);
    assert.equal(names.includes("CodexMulti"), true);
    assert.equal(
        names.includes("CodexMulti_CodexMultiA") || names.includes("CodexMulti_CodexMultiB"),
        true,
    );

    const override = outputs.find((schema) => schema.config.name === "CodexAliasOverride")!;
    assert.equal(override.config.exportToTS, false);
    assert.deepEqual(override.config.additionalDataPostProcess, { key: "BaseAlias" });
    assert.equal(override.config.useSchemaConfigNameAsKey, true);
    assert.match(String(override.config.outputMappingSource), /CodexAliasA\.yml$/);

    const disabled = outputs.find((schema) => schema.config.name === "BaseAlias_CodexDisabled")!;
    assert.equal(disabled.config.useSchemaConfigNameAsKey, false);
    assert.equal(disabled.config.additionalDataPostProcess, undefined);

    const badAliasOutput = await runGenerateSchema(root, [sourceA], {
        schemaAliasFile: normalize(writeFile(path.join(root, "bad-alias.yml"), [
            "aliases:",
            "  - sourceBaseName: CodexAliasA",
            "    schemaBaseName: BaseAlias",
            "  - sourceBaseName: CodexAliasA",
            "    schemaBaseName: BaseAlias",
        ].join("\n"))),
    });
    assert.deepEqual(badAliasOutput, []);

    fs.rmSync(root, { recursive: true, force: true });
});

test("GenerateSchema avoids fallback post-process when override key is registered", async () => {
    const root = createTempDir("k-export-flow-generate-schema-registered-");
    const schemaDir = path.join(root, "schema");
    const source = writeFile(path.join(root, "csv", "CodexRegistered.csv"), "id\n1\n");
    writeFile(path.join(schemaDir, "BaseRegistered.yml"), [
        "type: data-table",
        "name: BaseRegistered",
        "fields:",
        "  - name: id",
        "    type: int",
    ].join("\n"));
    DataPostProcess.registerDataPostProcess("CodexRegisteredOverride", () => {});
    const aliasFile = writeFile(path.join(root, "schema-alias.yml"), [
        "aliases:",
        "  - sourceBaseName: CodexRegistered",
        "    schemaBaseName: BaseRegistered",
        "    nameOverride: CodexRegisteredOverride",
    ].join("\n"));

    const outputs = await runGenerateSchema(root, [source], { schemaAliasFile: normalize(aliasFile) }) as Schema[];
    assert.equal(outputs[0].config.name, "CodexRegisteredOverride");
    assert.equal(outputs[0].config.additionalDataPostProcess, undefined);
    assert.equal(outputs[0].config.useSchemaConfigNameAsKey, true);

    fs.rmSync(root, { recursive: true, force: true });
});

test("ExportRunStats and ExportSummary classify, ignore, and render verbose and compact summaries", async () => {
    const root = createTempDir("k-export-flow-summary-");
    const logs: string[] = [];
    const oldLog = console.log;
    console.log = (message?: unknown) => {
        logs.push(String(message));
    };

    try {
        ExportRunStats.resetInstance(root);
        const stats = ExportRunStats.getInstance();
        stats.recordAdded(path.join(root, "TempSaved/export-flow/output/client/config/Hero.json"));
        stats.recordModified(path.join(root, "TypeScripts/packages/client/src/generated/data-table/Hero.ts"));
        stats.recordAdded(path.join(root, "TypeScripts/packages/client/src/generated/ini/Settings.ts"));
        stats.recordDeleted(path.join(root, "LuaScripts/DataCenter/NewConfig/Hero.lua"));
        stats.recordAdded(path.join(root, "TempSaved/export-flow/csv/Hero.csv"));
        stats.recordAdded(path.join(root, "TempSaved/export-flow/export-csv-increment-info.json"));

        assert.deepEqual(stats.getChanges().map((change) => change.path), [
            "LuaScripts/DataCenter/NewConfig/Hero.lua",
            "TempSaved/export-flow/output/client/config/Hero.json",
            "TypeScripts/packages/client/src/generated/data-table/Hero.ts",
            "TypeScripts/packages/client/src/generated/ini/Settings.ts",
        ]);
        assert.equal(normalizeExportPath(`${root}\\`, root), "");
        assert.equal(normalizeExportPath("./ResProject/Assets/Other.txt"), "Assets/Other.txt");
        assert.equal(classifyExportOutputPath(path.join(root, "yaml-cache.json"), root), undefined);

        const summary = stats.getSummary();
        assert.deepEqual(summary[ExportOutputFileType.Json][ExportOutputChangeType.Added], ["TempSaved/export-flow/output/client/config/Hero.json"]);
        assert.deepEqual(summary[ExportOutputFileType.TypeScriptIni][ExportOutputChangeType.Added], ["TypeScripts/packages/client/src/generated/ini/Settings.ts"]);

        ExportLogger.setVerbose(false);
        const compact = Processor.create("ExportSummary");
        assert.ok(compact);
        compact.config = {
            type: "ExportSummary",
            description: "compact",
            ignorePatterns: [
                "LuaScripts/DataCenter/NewConfig/Hero.lua",
                "/Hero\\.json$/",
            ],
        };
        await compact.processAll([undefined]);
        assert.match(logs.at(-1) ?? "", /Modified: 1/);
        assert.doesNotMatch(logs.at(-1) ?? "", /\[M\]/);

        ExportLogger.setVerbose(true);
        const verbose = Processor.create("ExportSummary");
        assert.ok(verbose);
        verbose.config = {
            type: "ExportSummary",
            description: "verbose",
        };
        await verbose.processAll([undefined]);
        assert.match(logs.at(-1) ?? "", /\[A\] TempSaved\/export-flow\/output\/client\/config\/Hero\.json/);
        assert.match(logs.at(-1) ?? "", /\[M\] TypeScripts\/packages\/client\/src\/generated\/data-table\/Hero\.ts/);
        assert.match(logs.at(-1) ?? "", /\[D\] LuaScripts\/DataCenter\/NewConfig\/Hero\.lua/);

        stats.clear();
        await verbose.processAll([undefined]);
        assert.match(logs.at(-1) ?? "", /No output file changes/);

        stats.recordAdded(path.join(root, "Assets/Other.txt"));
        stats.renderSummary();
        assert.match(logs.at(-1) ?? "", /\[A\] Assets\/Other\.txt/);
    } finally {
        console.log = oldLog;
        ExportLogger.setVerbose(false);
        fs.rmSync(root, { recursive: true, force: true });
    }
});
