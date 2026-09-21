import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Manager } from "../src/new";

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
        ["incrementBuild", "false"],
        ["language", "ZH_CN"],
        ["environment", "dev"],
        ["verbose", "false"],
    ]));
}

function buildPipeline(root: string, tsDir: string, importPathMapLines: string[]): string {
    const csvDir = path.join(root, "csv");
    const schemaDir = path.join(root, "schema");
    const jsonDir = path.join(root, "json");
    return [
        "processors:",
        "  - type: PrepareDir",
        "    paths:",
        `      - "${normalize(jsonDir)}"`,
        `      - "${normalize(tsDir)}"`,
        "  - type: CollectFile",
        `    rootPaths: ["${normalize(csvDir)}"]`,
        "    includeExtensions: [.csv]",
        "  - type: GenerateSchema",
        "    extensions: [.yml]",
        "    targetMapping:",
        "      type: FindWithBaseName",
        `      targetDir: "${normalize(schemaDir)}"`,
        "  - type: GenerateRawData",
        "  - type: SerializeToJson",
        "    targetMapping:",
        "      type: GenerateWithBaseName",
        `      baseDir: "${normalize(schemaDir)}"`,
        `      targetDir: "${normalize(jsonDir)}"`,
        "      extension: .json",
        "  - type: ExportJsonDataTableToTypeScript",
        `    targetDir: "${normalize(tsDir)}"`,
        ...importPathMapLines,
        "    jsonTargetMapping:",
        "      type: GenerateWithBaseName",
        `      baseDir: "${normalize(schemaDir)}"`,
        "      targetDir: config",
        "      resolvePath: false",
        "      checkInBaseDir: true",
        "      extension: .json",
    ].join("\n");
}

async function setupTable(root: string): Promise<void> {
    writeFile(path.join(root, "csv", "Hero.csv"), [
        "id,name",
        "1,Alpha",
    ].join("\n"));
    writeFile(path.join(root, "schema", "Hero.yml"), [
        "type: data-table",
        "name: Hero",
        "key: id",
        "fields:",
        "  - name: id",
        "    type: int",
        "  - name: name",
        "    type: string",
    ].join("\n"));
}

test("importPathMap rewrites generated import specifiers", async () => {
    const root = createTempDir("k-export-flow-import-path-map-");
    const tsDir = path.join(root, "ts");
    await setupTable(root);

    await runPipeline(root, buildPipeline(root, tsDir, [
        "    importPathMap:",
        '      "k-ts-framework": "../framework/k-ts-framework"',
        '      "game-data-collection": "../framework/game-data-collection"',
    ]));
    await Manager.getInstance().flushPendingCacheWrites();

    const content = fs.readFileSync(path.join(tsDir, "Hero.ts"), "utf-8");
    assert.match(content, /from "\.\.\/framework\/k-ts-framework"/);
    assert.match(content, /from "\.\.\/framework\/game-data-collection"/);
    assert.doesNotMatch(content, /from "k-ts-framework"/);
    assert.doesNotMatch(content, /from "game-data-collection"/);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("generated imports keep bare specifiers when importPathMap is absent", async () => {
    const root = createTempDir("k-export-flow-import-path-default-");
    const tsDir = path.join(root, "ts");
    await setupTable(root);

    await runPipeline(root, buildPipeline(root, tsDir, []));
    await Manager.getInstance().flushPendingCacheWrites();

    const content = fs.readFileSync(path.join(tsDir, "Hero.ts"), "utf-8");
    assert.match(content, /from "k-ts-framework"/);
    assert.match(content, /from "game-data-collection"/);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});
