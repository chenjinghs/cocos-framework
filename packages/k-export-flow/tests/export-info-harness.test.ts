import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    ArrayFieldDeclaration,
    createDefaultGlobalConfig,
    DataTableSchema,
    DataWithSchema,
    EFieldType,
    ExportInfoToTypeScript,
    FieldDeclaration,
    GENERATED_TS_FILE_HEADER,
    MapFieldDeclaration,
    OneOfDeclaration,
    parseLocalizationConfig,
    setGlobalConfig,
    StructDeclaration,
    TaggedInfoExtraData,
    TemplateDeclarationSet,
} from "../src/new";

class CodexExportInfoHarness extends ExportInfoToTypeScript {
    protected override exportTS(data: DataWithSchema, tableName: string, jsonPath: string, out: string[]): void {
        out.push(`// ${tableName}:${jsonPath}`);
        const templateName = this.exportInterface(tableName, data.schema.declarationSet, "BaseTemplate", out);
        out.push(`export type TemplateName = ${templateName};`);
        this.exportFunctionDeprecatedDesc(out, "oldFind", "findTemplate");
    }
}

function createTempDir(name: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function normalize(file: string): string {
    return file.replace(/\\/g, "/");
}

function createSchema(root: string): DataWithSchema {
    const schema = new DataTableSchema();
    schema.config = {
        type: "data-table",
        name: "CodexInfoHarness",
        fields: [],
    };
    schema.schemaFiles = [path.join(root, "schema", "CodexInfoHarness.yml")];
    schema.declarationSet = new TemplateDeclarationSet();
    schema.declarationSet.interfaces.set("CodexStruct", new StructDeclaration());
    schema.declarationSet.interfaces.get("CodexStruct")!.fields.set("count", new FieldDeclaration(EFieldType.Int, false));
    schema.declarationSet.interfaces.get("CodexStruct")!.fields.set("label", new FieldDeclaration(EFieldType.String, true));

    const choice = new OneOfDeclaration("kind");
    choice.fields.set("kind", new FieldDeclaration(EFieldType.String, false));
    choice.fields.set("damage", new FieldDeclaration(EFieldType.Int, true));
    choice.fields.set("texts", new ArrayFieldDeclaration(new FieldDeclaration(EFieldType.String, false), true));
    schema.declarationSet.interfaces.set("CodexChoice", choice);

    schema.declarationSet.fields.set("unionList", new ArrayFieldDeclaration([
        new FieldDeclaration(EFieldType.Int, false),
        new FieldDeclaration(EFieldType.String, false),
    ] as unknown as FieldDeclaration, false));
    schema.declarationSet.fields.set("structMap", new MapFieldDeclaration(
        new FieldDeclaration(EFieldType.String, false),
        new FieldDeclaration("CodexStruct", true),
        true,
    ));
    schema.declarationSet.fields.set("choice", new FieldDeclaration("CodexChoice", false));
    schema.declarationSet.fields.set("flag", new FieldDeclaration(EFieldType.Bool, true));
    schema.declarationSet.fields.set("amount", new FieldDeclaration(EFieldType.BigInt, false));

    const output = new DataWithSchema({}, schema);
    output.addExtraData(new TaggedInfoExtraData(["export const EXTRA = true;"]));
    return output;
}

test("ExportInfoToTypeScript harness covers interface generation, tagged info, and file change recording", async () => {
    const globalConfig = createDefaultGlobalConfig();
    setGlobalConfig(globalConfig);
    parseLocalizationConfig(globalConfig.localization);

    const root = createTempDir("k-export-flow-export-info-");
    const schemaDir = path.join(root, "schema");
    const tsDir = path.join(root, "ts");
    fs.mkdirSync(schemaDir, { recursive: true });
    fs.mkdirSync(tsDir, { recursive: true });
    fs.writeFileSync(path.join(tsDir, "CodexInfoHarness.ts"), "stale", "utf-8");
    fs.writeFileSync(path.join(tsDir, "index.ts"), "export * as Existing from \"./Existing\";\n", "utf-8");

    const data = createSchema(root);
    const processor = new CodexExportInfoHarness();
    processor.config = {
        type: "CodexExportInfoHarness",
        targetDir: normalize(tsDir),
        outputLog: true,
        jsonTargetMapping: {
            type: "GenerateWithBaseName",
            baseDir: normalize(schemaDir),
            targetDir: "client/config",
            extension: ".json",
            resolvePath: false,
            checkInBaseDir: true,
        },
    };

    await processor.onPreProcessAll([data]);
    assert.equal(await processor.processSingle(data), data);
    await processor.onPostProcessAll([data]);

    const exported = fs.readFileSync(path.join(tsDir, "CodexInfoHarness.ts"), "utf-8");
    assert.match(exported, /export interface ICodexStruct/);
    assert.match(exported, /export type CodexChoiceOneOfType = "damage"\|"texts";/);
    assert.match(exported, /kind: CodexChoiceOneOfType;/);
    assert.match(exported, /unionList: Array<number \| string>;/);
    assert.match(exported, /structMap\?: Map<string, ICodexStruct>;/);
    assert.match(exported, /flag\?: boolean;/);
    assert.match(exported, /amount: bigint;/);
    assert.match(exported, /export const EXTRA = true;/);
    assert.match(exported, /@deprecated/);

    const index = fs.readFileSync(path.join(tsDir, "index.ts"), "utf-8");
    // 旧 `export * as` 行(Creator 3.8 预览 bundler 会静默丢弃)被自愈为 import + export 格式
    assert.doesNotMatch(index, /export \* as/);
    assert.match(index, /import \* as CodexInfoHarness from "\.\/CodexInfoHarness";/);
    assert.match(index, /export \{ CodexInfoHarness \};/);

    fs.rmSync(root, { recursive: true, force: true });
});

test("ExportInfoToTypeScript repairs index entries for existing generated files", async () => {
    const globalConfig = createDefaultGlobalConfig();
    setGlobalConfig(globalConfig);
    parseLocalizationConfig(globalConfig.localization);

    const root = createTempDir("k-export-flow-export-index-repair-");
    const schemaDir = path.join(root, "schema");
    const tsDir = path.join(root, "ts");
    fs.mkdirSync(schemaDir, { recursive: true });
    fs.mkdirSync(tsDir, { recursive: true });
    fs.writeFileSync(path.join(tsDir, "index.ts"), [
        GENERATED_TS_FILE_HEADER.trimEnd(),
        "",
        "export * as Existing from \"./Existing\";",
    ].join("\n"), "utf-8");
    fs.writeFileSync(path.join(tsDir, "Existing.ts"), "export const existing = true;", "utf-8");
    fs.writeFileSync(path.join(tsDir, "CachedButMissingFromIndex.ts"), "export const cached = true;", "utf-8");

    const processor = new CodexExportInfoHarness();
    processor.config = {
        type: "CodexExportInfoHarness",
        targetDir: normalize(tsDir),
        jsonTargetMapping: {
            type: "GenerateWithBaseName",
            baseDir: normalize(schemaDir),
            targetDir: "client/config",
            extension: ".json",
            resolvePath: false,
            checkInBaseDir: true,
        },
    };

    await processor.onPreProcessAll([]);
    await processor.onPostProcessAll([]);

    const index = fs.readFileSync(path.join(tsDir, "index.ts"), "utf-8");
    assert.doesNotMatch(index, /export \* as/);
    assert.match(index, /import \* as Existing from "\.\/Existing";/);
    assert.match(index, /export \{ Existing \};/);
    assert.match(index, /import \* as CachedButMissingFromIndex from "\.\/CachedButMissingFromIndex";/);
    assert.match(index, /export \{ CachedButMissingFromIndex \};/);

    fs.rmSync(root, { recursive: true, force: true });
});
