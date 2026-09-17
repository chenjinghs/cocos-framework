import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DataPostProcess, Manager, TargetMapping, setCustomDeclaration } from "../src/new";

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

async function runPipeline(root: string, pipelineBody: string): Promise<unknown[] | undefined> {
    const pipeline = writeFile(path.join(root, "pipeline.yml"), pipelineBody);
    return await Manager.getInstance().run(pipeline, new Map<string, string>([
        ["rootPath", normalize(root)],
        ["incrementBuild", "true"],
        ["language", "EN_US"],
        ["environment", "dev"],
    ]));
}

test("TargetMapping covers find, generate, group, source-map, replaced-name, and invalid mapping branches", async () => {
    const root = createTempDir("k-export-flow-target-mapping-");
    const targetDir = path.join(root, "targets");
    const nestedTargetDir = path.join(root, "nested-targets");
    const sourceDir = path.join(root, "source");
    fs.mkdirSync(path.join(root, "empty"), { recursive: true });

    const keep = writeFile(path.join(targetDir, "group", "Keep.ts"), "export const keep = true;");
    writeFile(path.join(targetDir, "Drop.ts"), "drop");
    const replaced = writeFile(path.join(targetDir, "HeroGenerated.ts"), "generated");
    const tsFile = writeFile(path.join(root, "bundle", "source.ts"), "export const source = true;");
    const jsFile = writeFile(path.join(root, "bundle", "source.js"), "compiled");
    writeFile(path.join(root, "bundle", "source.js.map"), JSON.stringify({ sources: ["source.ts"] }));

    const find = await TargetMapping.create({ type: "FindWithBaseName", targetDir: normalize(targetDir), excludeNames: ["Drop"] });
    assert.equal(await find.getTarget("some/Keep.csv"), keep);
    assert.equal(await find.getTarget("some/Drop.csv"), undefined);

    const generated = await TargetMapping.create({
        type: "GenerateWithBaseName",
        baseDir: normalize(sourceDir),
        targetDir: normalize(nestedTargetDir),
        extension: ".json",
        resolvePath: false,
        checkInBaseDir: true,
    });
    assert.equal(await generated.getTarget(path.join(sourceDir, "sub", "Config.csv")), path.join(nestedTargetDir, "sub", "Config.json"));
    assert.equal(await generated.getTarget(path.join(root, "outside", "Config.csv")), undefined);

    const looseGenerated = await TargetMapping.create({
        type: "GenerateWithBaseName",
        baseDir: normalize(sourceDir),
        targetDir: normalize(nestedTargetDir),
        extension: ".json",
        resolvePath: false,
    });
    assert.equal(await looseGenerated.getTarget(path.join(root, "outside", "Other.csv")), path.join(root, "outside", "Other.json"));

    const group = await TargetMapping.create({
        type: "TargetMappingGroup",
        mappings: [
            { type: "FindWithBaseName", targetDir: normalize(path.join(root, "empty")) },
            { type: "FindWithBaseName", targetDir: normalize(targetDir), excludeNames: ["Drop"] },
        ],
    });
    assert.equal(await group.getTarget("Keep.csv"), keep);
    assert.equal(await group.getTarget("Missing.csv"), undefined);

    const sourceMap = await TargetMapping.create({ type: "FindTSPathByJSFile" });
    assert.equal(await sourceMap.getTarget(tsFile), tsFile);
    assert.equal(await sourceMap.getTarget(path.join(root, "bundle", "style.css")), undefined);
    assert.equal(await sourceMap.getTarget(jsFile), tsFile);

    const replacedName = await TargetMapping.create({
        type: "FindWithReplacedBaseName",
        targetDir: normalize(targetDir),
        replaces: [{ from: "/Raw/", to: "Generated" }],
    });
    assert.equal(await replacedName.getTarget("HeroRaw.csv"), replaced);
    assert.equal(await replacedName.getTarget("HeroPlain.csv"), undefined);

    writeFile(path.join(root, "dup-a", "Same.ts"), "a");
    writeFile(path.join(root, "dup-b", "Same.ts"), "b");
    await assert.rejects(() => TargetMapping.create({ type: "FindWithBaseName", targetDir: normalize(root) }), /duplicate-base-name|duplicated/i);
    await assert.rejects(() => TargetMapping.create({ type: "MissingTargetMapping" }), /MissingTargetMapping|invalid-file-mapping-type/);

    fs.rmSync(root, { recursive: true, force: true });
});

test("TypeScript export covers custom, array, version fallback, custom body, index append, and escaped names", async () => {
    const root = createTempDir("k-export-flow-ts-export-");
    const csvDir = path.join(root, "csv");
    const schemaDir = path.join(root, "schema");
    const tsDir = path.join(root, "ts");

    DataPostProcess.registerDataPostProcess("CodexMarkCustomTable", (output) => {
        setCustomDeclaration(output, true);
    });

    writeFile(path.join(tsDir, "index.ts"), [
        "/***************************************************************",
        " * existing index",
        " **************************************************************/",
        "",
        "export * as CodexVersioned from \"./CodexVersioned\";",
    ].join("\n"));
    writeFile(path.join(tsDir, "CodexVersioned.ts"), "stale");

    writeFile(path.join(csvDir, "CodexVersioned.csv"), [
        "version,id,name",
        "1,10,Alpha",
        "0,10,Fallback",
    ].join("\n"));
    writeFile(path.join(csvDir, "CodexVersionOnly.csv"), [
        "version,name",
        "1,Alpha",
        "0,Fallback",
    ].join("\n"));
    writeFile(path.join(csvDir, "CodexArray.csv"), [
        "id,name",
        "1,Alpha",
        "2,Beta",
    ].join("\n"));
    writeFile(path.join(csvDir, "CodexCustom.csv"), [
        "id,name",
        "1,Alpha",
    ].join("\n"));
    writeFile(path.join(csvDir, "CodexBody.csv"), [
        "id,name",
        "1,Alpha",
    ].join("\n"));
    writeFile(path.join(csvDir, "CodexSkip.csv"), [
        "id,name",
        "1,Alpha",
    ].join("\n"));
    writeFile(path.join(csvDir, "CodexTilde.csv"), [
        "id,name",
        "1,Alpha",
    ].join("\n"));

    writeFile(path.join(schemaDir, "CodexVersioned.yml"), [
        "type: data-table",
        "name: CodexVersioned",
        "key: [version, id]",
        "versionFallback: true",
        "tag: combat",
        "fields:",
        "  - name: version",
        "    type: int",
        "  - name: id",
        "    type: int",
        "  - name: name",
        "    type: string",
    ].join("\n"));
    writeFile(path.join(schemaDir, "CodexVersionOnly.yml"), [
        "type: data-table",
        "name: CodexVersionOnly",
        "key: version",
        "versionFallback: true",
        "fields:",
        "  - name: version",
        "    type: int",
        "  - name: name",
        "    type: string",
    ].join("\n"));
    writeFile(path.join(schemaDir, "CodexArray.yml"), [
        "type: data-table",
        "name: CodexArray",
        "exportTemplateCountToTS: true",
        "fields:",
        "  - name: id",
        "    type: int",
        "  - name: name",
        "    type: string",
    ].join("\n"));
    writeFile(path.join(schemaDir, "CodexCustom.yml"), [
        "type: data-table",
        "name: CodexCustom",
        "key: id",
        "additionalDataPostProcess:",
        "  key: CodexMarkCustomTable",
        "fields:",
        "  - name: id",
        "    type: int",
        "  - name: name",
        "    type: string",
    ].join("\n"));
    writeFile(path.join(schemaDir, "CodexBody.yml"), [
        "type: data-table",
        "name: CodexBody",
        "key: id",
        "findTemplateFuncBody: \"\\treturn undefined as unknown as %s; // %s\"",
        "fields:",
        "  - name: id",
        "    type: int",
        "  - name: name",
        "    type: string",
    ].join("\n"));
    writeFile(path.join(schemaDir, "CodexSkip.yml"), [
        "type: data-table",
        "name: CodexSkip",
        "key: id",
        "exportToTS: false",
        "fields:",
        "  - name: id",
        "    type: int",
        "  - name: name",
        "    type: string",
    ].join("\n"));
    writeFile(path.join(schemaDir, "CodexTilde.yml"), [
        "type: data-table",
        "name: Codex~Tilde",
        "key: id",
        "fields:",
        "  - name: id",
        "    type: int",
        "  - name: name",
        "    type: string",
    ].join("\n"));

    const result = await runPipeline(root, [
        "processors:",
        "  - type: CollectFile",
        `    rootPaths: ["${normalize(csvDir)}"]`,
        "    includeExtensions: [.csv]",
        "  - type: GenerateSchema",
        "    extensions: [.yml]",
        "    targetMapping:",
        "      type: FindWithBaseName",
        `      targetDir: "${normalize(schemaDir)}"`,
        "  - type: GenerateRawData",
        "  - type: PostProcess",
        "  - type: ExportJsonDataTableToTypeScript",
        `    targetDir: "${normalize(tsDir)}"`,
        "    jsonTargetMapping:",
        "      type: GenerateWithBaseName",
        `      baseDir: "${normalize(schemaDir)}"`,
        "      targetDir: client/config",
        "      resolvePath: false",
        "      checkInBaseDir: true",
        "      extension: .json",
    ].join("\n"));

    assert.equal(result?.length, 7);

    const versioned = fs.readFileSync(path.join(tsDir, "CodexVersioned.ts"), "utf-8");
    assert.match(versioned, /GDC\.EDataTableKeyType\.Double/);
    assert.match(versioned, /"combat"/);
    assert.match(versioned, /if \(ret \|\| version === 0\) return ret;/);
    assert.match(versioned, /findJsonDataTableTemplateByKey<ICodexVersionedTemplate>\(dataTable\(\), 0, id\)/);
    assert.match(versioned, /F\.assert\(ret/);

    const versionOnly = fs.readFileSync(path.join(tsDir, "CodexVersionOnly.ts"), "utf-8");
    assert.match(versionOnly, /if \(ret \|\| version === 0\) return ret;/);
    assert.match(versionOnly, /findJsonDataTableTemplateByKey<ICodexVersionOnlyTemplate>\(dataTable\(\), 0\)/);

    const arrayTable = fs.readFileSync(path.join(tsDir, "CodexArray.ts"), "utf-8");
    assert.match(arrayTable, /GDC\.EDataTableKeyType\.Array/);
    assert.match(arrayTable, /export const TEMPLATE_COUNT = 2;/);
    assert.match(arrayTable, /findTemplate\(index: number\)/);

    const customTable = fs.readFileSync(path.join(tsDir, "CodexCustom.ts"), "utf-8");
    assert.match(customTable, /GDC\.EDataTableKeyType\.Custom/);
    assert.match(customTable, /function getAllCustomData<T>\(\): T/);

    const customBody = fs.readFileSync(path.join(tsDir, "CodexBody.ts"), "utf-8");
    assert.match(customBody, /return undefined as unknown as ICodexBodyTemplate; \/\/ id/);
    assert.equal(fs.existsSync(path.join(tsDir, "CodexSkip.ts")), false);

    const index = fs.readFileSync(path.join(tsDir, "index.ts"), "utf-8");
    assert.match(index, /export \* as CodexVersioned from "\.\/CodexVersioned";/);
    assert.match(index, /export \* as Codex_Tilde from "\.\/Codex~Tilde";/);
    assert.match(index, /export \* as CodexArray from "\.\/CodexArray";/);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});
