// 产物生命周期:资源目录不被重建(.meta 存活)、陈旧产物被 Mirror 清理、
// 缺 schema 的源文件必须报错、index.ts 字节形态在"新建"与"更新"两条路径下一致。
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

async function runPipeline(root: string, pipelineBody: string, incrementBuild = false): Promise<string | undefined> {
    const pipeline = writeFile(path.join(root, "pipeline.yml"), pipelineBody);
    const manager = Manager.getInstance();
    await manager.run(pipeline, new Map<string, string>([
        ["rootPath", normalize(root)],
        ["incrementBuild", incrementBuild ? "true" : "false"],
        ["language", "ZH_CN"],
        ["environment", "dev"],
        ["verbose", "false"],
    ]), false);
    const lastError = manager.getLastError();
    if (lastError === undefined) await manager.flushPendingCacheWrites();
    return lastError;
}

function writeTable(root: string, name: string): void {
    writeFile(path.join(root, "csv", `${name}.csv`), [
        "id,name",
        "1,Alpha",
    ].join("\n"));
    writeFile(path.join(root, "schema", `${name}.yml`), [
        "type: data-table",
        `name: ${name}`,
        "key: id",
        "fields:",
        "  - name: id",
        "    type: int",
        "  - name: name",
        "    type: string",
    ].join("\n"));
}

/** 产物目录经 Mirror 落地的完整管线:中间产物在 temp 下重建,资源目录只 ensure */
function buildPipeline(root: string, options?: { onMissingSchema?: string; incrementGate?: boolean }): string {
    const csvDir = path.join(root, "csv");
    const schemaDir = path.join(root, "schema");
    const tempJsonDir = path.join(root, "temp", "json");
    const tempTsDir = path.join(root, "temp", "ts");
    const assetJsonDir = path.join(root, "assets", "config");
    const assetTsDir = path.join(root, "assets", "ts");

    return [
        "processors:",
        "  - type: PrepareDir",
        "    paths:",
        `      - "${normalize(tempJsonDir)}"`,
        `      - "${normalize(tempTsDir)}"`,
        "    ensurePaths:",
        `      - "${normalize(assetJsonDir)}"`,
        `      - "${normalize(assetTsDir)}"`,
        "  - type: CollectFile",
        `    rootPaths: ["${normalize(csvDir)}"]`,
        "    includeExtensions: [.csv]",
        "  - type: GenerateSchema",
        "    extensions: [.yml]",
        ...(options?.onMissingSchema ? [`    onMissingSchema: ${options.onMissingSchema}`] : []),
        "    targetMapping:",
        "      type: FindWithBaseName",
        `      targetDir: "${normalize(schemaDir)}"`,
        ...(options?.incrementGate ? [
            "  - type: CollectChangedSchema",
            `    tempPath: "${normalize(path.join(root, "temp"))}"`,
        ] : []),
        "  - type: GenerateRawData",
        "  - type: SerializeToJson",
        "    targetMapping:",
        "      type: GenerateWithBaseName",
        `      baseDir: "${normalize(schemaDir)}"`,
        `      targetDir: "${normalize(tempJsonDir)}"`,
        "      extension: .json",
        "  - type: ExportJsonDataTableToTypeScript",
        `    targetDir: "${normalize(tempTsDir)}"`,
        "    jsonTargetMapping:",
        "      type: GenerateWithBaseName",
        `      baseDir: "${normalize(schemaDir)}"`,
        "      targetDir: config",
        "      resolvePath: false",
        "      checkInBaseDir: true",
        "      extension: .json",
        "  - type: PathOperation",
        "    operations:",
        "      - type: Mirror",
        `        from: "${normalize(tempJsonDir)}"`,
        `        to: "${normalize(assetJsonDir)}"`,
        "      - type: Mirror",
        `        from: "${normalize(tempTsDir)}"`,
        `        to: "${normalize(assetTsDir)}"`,
    ].join("\n");
}

test("Mirror drops outputs whose source is gone and keeps .meta of surviving outputs", async () => {
    const root = createTempDir("k-export-flow-mirror-");
    const assetTsDir = path.join(root, "assets", "ts");
    const assetJsonDir = path.join(root, "assets", "config");

    writeTable(root, "Hero");
    writeTable(root, "Monster");
    assert.equal(await runPipeline(root, buildPipeline(root)), undefined);

    // 编辑器为每个产物生成 .meta（uuid 载体），这里模拟其存在
    for (const file of [...fs.readdirSync(assetTsDir), ...fs.readdirSync(assetJsonDir)]) {
        const dir = file.endsWith(".json") ? assetJsonDir : assetTsDir;
        writeFile(path.join(dir, `${file}.meta`), `{"uuid":"${file}"}`);
    }
    assert.equal(fs.existsSync(path.join(assetTsDir, "Monster.ts.meta")), true);

    // Monster 源表被删除后重跑：产物与其 .meta 一起消失，Hero 的 .meta 原样保留
    fs.rmSync(path.join(root, "csv", "Monster.csv"));
    fs.rmSync(path.join(root, "schema", "Monster.yml"));
    assert.equal(await runPipeline(root, buildPipeline(root)), undefined);

    assert.equal(fs.existsSync(path.join(assetTsDir, "Monster.ts")), false);
    assert.equal(fs.existsSync(path.join(assetTsDir, "Monster.ts.meta")), false);
    assert.equal(fs.existsSync(path.join(assetJsonDir, "Monster.json")), false);
    assert.equal(fs.existsSync(path.join(assetJsonDir, "Monster.json.meta")), false);

    assert.equal(fs.existsSync(path.join(assetTsDir, "Hero.ts")), true);
    assert.equal(fs.readFileSync(path.join(assetTsDir, "Hero.ts.meta"), "utf-8"), `{"uuid":"Hero.ts"}`);
    assert.equal(fs.existsSync(path.join(assetTsDir, "index.ts.meta")), true);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("Mirror keeps untouched outputs when an increment build only regenerates changed tables", async () => {
    const root = createTempDir("k-export-flow-mirror-increment-");
    const assetTsDir = path.join(root, "assets", "ts");
    const assetJsonDir = path.join(root, "assets", "config");

    writeTable(root, "Hero");
    writeTable(root, "Monster");
    assert.equal(await runPipeline(root, buildPipeline(root, { incrementGate: true })), undefined);
    assert.equal(fs.existsSync(path.join(assetJsonDir, "Monster.json")), true);

    // 上一轮全量在 PrepareDir 之后失败时,中间目录已被清空又没重新产出。
    // 紧接着的增量只会重新产出变更表——中间目录是产物全集的子集,不能拿它当清理依据。
    fs.rmSync(path.join(root, "temp", "json"), { recursive: true, force: true });
    fs.rmSync(path.join(root, "temp", "ts"), { recursive: true, force: true });
    writeFile(path.join(root, "csv", "Hero.csv"), "id,name\n1,Alpha\n2,Beta");

    assert.equal(await runPipeline(root, buildPipeline(root, { incrementGate: true }), true), undefined);

    assert.equal(fs.existsSync(path.join(assetJsonDir, "Monster.json")), true);
    assert.equal(fs.existsSync(path.join(assetTsDir, "Monster.ts")), true);
    assert.match(fs.readFileSync(path.join(assetJsonDir, "Hero.json"), "utf-8"), /Beta/);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("PrepareDir recreates paths but only ensures ensurePaths in a full build", async () => {
    const root = createTempDir("k-export-flow-ensure-paths-");
    const tempDir = path.join(root, "temp");
    const assetDir = path.join(root, "assets");
    const wipedFile = writeFile(path.join(tempDir, "stale.ts"), "stale");
    const keptFile = writeFile(path.join(assetDir, "Hand.ts.meta"), `{"uuid":"hand"}`);

    const lastError = await runPipeline(root, [
        "processors:",
        "  - type: PrepareDir",
        "    paths:",
        `      - "${normalize(tempDir)}"`,
        "    ensurePaths:",
        `      - "${normalize(assetDir)}"`,
    ].join("\n"));
    assert.equal(lastError, undefined);

    // 资源目录(带受版本管理的 .meta)重建即丢 uuid,必须只 ensure
    assert.equal(fs.existsSync(wipedFile), false);
    assert.equal(fs.readFileSync(keptFile, "utf-8"), `{"uuid":"hand"}`);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("GenerateSchema onMissingSchema=error reports the source file and stops the run", async () => {
    const root = createTempDir("k-export-flow-missing-schema-");
    writeTable(root, "Hero");
    writeFile(path.join(root, "csv", "NoSchema.csv"), "id,name\n1,Alpha");

    const lastError = await runPipeline(root, buildPipeline(root, { onMissingSchema: "error" }));
    assert.match(String(lastError), /NoSchema\.csv/);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("GenerateSchema onMissingSchema=ignore keeps the schema-less source silent", async () => {
    const root = createTempDir("k-export-flow-missing-schema-ignore-");
    writeTable(root, "Hero");
    writeFile(path.join(root, "csv", "NoSchema.csv"), "id,name\n1,Alpha");

    assert.equal(await runPipeline(root, buildPipeline(root, { onMissingSchema: "ignore" })), undefined);
    assert.equal(fs.existsSync(path.join(root, "assets", "ts", "Hero.ts")), true);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("index.ts bytes are identical whether it was created or updated in place", async () => {
    const root = createTempDir("k-export-flow-index-bytes-");
    const indexFile = path.join(root, "temp", "ts", "index.ts");

    writeTable(root, "Hero");
    assert.equal(await runPipeline(root, buildPipeline(root)), undefined);
    const created = fs.readFileSync(indexFile, "utf-8");

    // 第二轮索引文件已存在,走"更新"分支;字节必须与"新建"分支一致,否则全量/增量来回切就制造 diff
    assert.equal(await runPipeline(root, buildPipeline(root), true), undefined);
    assert.equal(fs.readFileSync(indexFile, "utf-8"), created);

    assert.equal(created.endsWith("\n"), true);
    assert.doesNotMatch(created, /\n\n\n/);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});
