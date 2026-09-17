import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    COLLECT_CHANGED_SCHEMA_CACHE_VERSION,
    CollectChangedSchema,
    DataTableKeyField,
    EFieldType,
    FilePathData,
    Manager,
    PostProcessDependencyRegistry,
    Processor,
    Schema,
    createDefaultGlobalConfig,
    parseLocalizationConfig,
    registerCollectChangedSchemaCheckFunc,
    registerEarlyFilterFilePathDataCheckFunc,
    registerFilterChangedFilePathDataCheckFunc,
    setGlobalConfig,
} from "../src/new";

import type { DataType, IData } from "../src/new";

let fileSeedData: FilePathData[] = [];
let schemaSeedData: Schema[] = [];

class CodexIncrementalFileSeed extends Processor<CodexIncrementalFileSeed> {
    public inputDataType = undefined;
    public outputDataType = FilePathData;

    protected processSingle(): FilePathData[] {
        return fileSeedData;
    }
}
CodexIncrementalFileSeed.register();

class CodexIncrementalSchemaSeed extends Processor<CodexIncrementalSchemaSeed> {
    public inputDataType = undefined;
    public outputDataType = Schema;

    protected processSingle(): Schema[] {
        return schemaSeedData;
    }
}
CodexIncrementalSchemaSeed.register();

function createTempDir(name: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function initLocalization(): void {
    const config = createDefaultGlobalConfig();
    setGlobalConfig(config);
    parseLocalizationConfig(config.localization);
}

function writeYaml(file: string, content: string): string {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content, "utf-8");
    return file;
}

function writeJson(file: string, data: unknown): void {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data), "utf-8");
}

function fileData(filePath: string, hash: string): FilePathData {
    return new FilePathData(filePath.replace(/\\/g, "/"), hash);
}

async function runPipeline(root: string, processorsYaml: string, args?: Map<string, string>): Promise<IData[] | undefined> {
    const pipeline = writeYaml(path.join(root, "pipeline.yml"), [
        "processors:",
        processorsYaml,
    ].join("\n"));

    return await Manager.getInstance().run(pipeline, args ?? new Map<string, string>([
        ["rootPath", root],
        ["incrementBuild", "true"],
    ]));
}

async function flushAndReadJson<T>(file: string): Promise<T> {
    await Manager.getInstance().flushPendingCacheWrites();
    return JSON.parse(fs.readFileSync(file, "utf-8")) as T;
}

function createSchema(name: string, sourcePath: string, hash: string, dataTableDeps?: string[]): Schema {
    const schema = new Schema();
    schema.config = {
        type: "data-table",
        name,
        fields: [],
    };
    schema.source = fileData(sourcePath, hash);
    schema.schemaFiles = [`${name}.meta.yml`];
    schema.fields = [];
    if (dataTableDeps && dataTableDeps.length > 0) {
        const keyField = new DataTableKeyField();
        keyField.config = {
            name: `${name}_dep`,
            type: EFieldType.DataTableKey,
            dataTableName: dataTableDeps,
            keyType: EFieldType.Int,
        };
        schema.fields.push(keyField);
    }
    return schema;
}

test("EarlyFilterFilePathData: xlsx 增量记录只放行对应 csv，并写入快照", async () => {
    initLocalization();
    const root = createTempDir("k-export-flow-increment-early-xlsx-");
    const tempPath = path.join(root, "TempSaved/export-flow");
    fileSeedData = [
        fileData("TempSaved/export-flow/csv/design-config/new_src/Hero.csv", "hero-new"),
        fileData("TempSaved/export-flow/csv/design-config/new_src/Item.csv", "item-new"),
    ];
    writeJson(path.join(tempPath, "export-csv-increment-info.json"), {
        "ExternalConfig/design-config/new_src/Hero.xlsx": "changed-hash",
    });
    writeJson(path.join(tempPath, "early-filter-file-path-data-info.json"), {
        version: 1,
        data: [
            fileData("TempSaved/export-flow/csv/design-config/new_src/Hero.csv", "hero-old"),
            fileData("TempSaved/export-flow/csv/design-config/new_src/Item.csv", "item-old"),
        ],
    });

    const result = await runPipeline(root, [
        "  - type: CodexIncrementalFileSeed",
        "    description: seed csv files",
        "  - type: EarlyFilterFilePathData",
        "    description: early filter",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
    ].join("\n"));

    assert.deepEqual(result?.map((data) => data.getDescription()), ["TempSaved/export-flow/csv/design-config/new_src/Hero.csv"]);

    const saved = await flushAndReadJson<{ data: FilePathData[] }>(path.join(tempPath, "early-filter-file-path-data-info.json"));
    assert.deepEqual(saved.data.map((data) => data.path).sort(), fileSeedData.map((data) => data.path).sort());

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("EarlyFilterFilePathData: xlsx 和自定义检查均无变更时全量通过，交由后续处理器精确过滤", async () => {
    initLocalization();
    const root = createTempDir("k-export-flow-increment-early-nochange-");
    const tempPath = path.join(root, "TempSaved/export-flow");
    fileSeedData = [
        fileData("csv/Hero.csv", "hero-hash"),
        fileData("csv/Item.csv", "item-hash"),
    ];
    writeJson(path.join(tempPath, "early-filter-file-path-data-info.json"), { version: 1, data: fileSeedData });

    const result = await runPipeline(root, [
        "  - type: CodexIncrementalFileSeed",
        "    description: seed csv files",
        "  - type: EarlyFilterFilePathData",
        "    description: early filter",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
    ].join("\n"));
    assert.deepEqual(result?.map((d) => d.getDescription()).sort(), fileSeedData.map((d) => d.path).sort());

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("EarlyFilterFilePathData: 非 Excel 文件变更可由自定义检查放行指定 csv，无变更时全量交给后续精确过滤", async () => {
    initLocalization();
    const root = createTempDir("k-export-flow-increment-early-custom-");
    const tempPath = path.join(root, "TempSaved/export-flow");
    const changedByScript = fileData("TempSaved/export-flow/csv/Server.csv", "server-new");
    fileSeedData = [
        fileData("TempSaved/export-flow/csv/Client.csv", "client-new"),
        changedByScript,
    ];
    writeJson(path.join(tempPath, "early-filter-file-path-data-info.json"), {
        version: 1,
        data: fileSeedData.map((data) => fileData(data.path, data.hash)),
    });

    registerEarlyFilterFilePathDataCheckFunc((_oldData, newData) => {
        return newData.filter((data) => data.path.endsWith("Server.csv"));
    });

    const customResult = await runPipeline(root, [
        "  - type: CodexIncrementalFileSeed",
        "    description: seed csv files",
        "  - type: EarlyFilterFilePathData",
        "    description: early filter",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
    ].join("\n"));
    assert.deepEqual(customResult?.map((data) => data.getDescription()), [changedByScript.path]);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("FilterChangedFilePathData: csv hash 变更触发分组联动，配置文件版本变化触发全量", async () => {
    initLocalization();
    const root = createTempDir("k-export-flow-increment-filter-");
    const tempPath = path.join(root, "TempSaved/export-flow");
    const settingFile = writeYaml(path.join(root, "groups.yml"), [
        "version: 2",
        "groups:",
        "  - name: battle",
        "    includeRegex: [\"battle/.*\\\\.csv$\"]",
        "    excludeRegex: [\"battle/Ignore\\\\.csv$\"]",
        "  - name: ui",
        "    includeRegex: [\"ui/.*\\\\.csv$\"]",
    ].join("\n"));
    fileSeedData = [
        fileData("battle/Hero.csv", "hero-new"),
        fileData("battle/Skill.csv", "skill-old"),
        fileData("battle/Ignore.csv", "ignore-old"),
        fileData("ui/Panel.csv", "panel-old"),
    ];
    writeJson(path.join(tempPath, "filter-changed-file-path-data-info.json"), {
        version: 2,
        data: [
            fileData("battle/Hero.csv", "hero-old"),
            fileData("battle/Skill.csv", "skill-old"),
            fileData("battle/Ignore.csv", "ignore-old"),
            fileData("ui/Panel.csv", "panel-old"),
        ],
    });

    const changedResult = await runPipeline(root, [
        "  - type: CodexIncrementalFileSeed",
        "    description: seed csv files",
        "  - type: FilterChangedFilePathData",
        "    description: filter changed csv",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
        `    settingFile: "${settingFile.replace(/\\/g, "/")}"`,
        "    groupSetting: groups",
    ].join("\n"));
    assert.deepEqual(changedResult?.map((data) => data.getDescription()).sort(), ["battle/Hero.csv", "battle/Skill.csv"]);

    writeJson(path.join(tempPath, "filter-changed-file-path-data-info.json"), {
        version: 1,
        data: [],
    });
    const versionChangedResult = await runPipeline(root, [
        "  - type: CodexIncrementalFileSeed",
        "    description: seed csv files",
        "  - type: FilterChangedFilePathData",
        "    description: filter changed csv",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
        `    settingFile: "${settingFile.replace(/\\/g, "/")}"`,
        "    groupSetting: groups",
    ].join("\n"));
    assert.deepEqual(versionChangedResult?.map((data) => data.getDescription()).sort(), fileSeedData.map((data) => data.path).sort());

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("FilterChangedFilePathData: yaml/ts 等非 csv 变更可由自定义检查补充到增量集合", async () => {
    initLocalization();
    const root = createTempDir("k-export-flow-increment-filter-custom-");
    const tempPath = path.join(root, "TempSaved/export-flow");
    fileSeedData = [
        fileData("config/Pipeline.csv", "same"),
        fileData("logic/PostProcess.csv", "same"),
    ];
    writeJson(path.join(tempPath, "filter-changed-file-path-data-info.json"), {
        version: 1,
        data: fileSeedData.map((data) => fileData(data.path, data.hash)),
    });

    registerFilterChangedFilePathDataCheckFunc((_oldData, newData) => {
        return newData.filter((data) => data.path.includes("PostProcess"));
    });
    const result = await runPipeline(root, [
        "  - type: CodexIncrementalFileSeed",
        "    description: seed csv files",
        "  - type: FilterChangedFilePathData",
        "    description: filter changed csv",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
        "    groupSetting: groups",
    ].join("\n"));

    assert.deepEqual(result?.map((data) => data.getDescription()), ["logic/PostProcess.csv"]);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("EarlyFilterFilePathData and FilterChangedFilePathData expand changed files after GenerateSchema", async () => {
    initLocalization();
    registerEarlyFilterFilePathDataCheckFunc(() => []);
    registerFilterChangedFilePathDataCheckFunc(() => []);

    const runExpansionCase = async (rootName: string, filterYaml: string, prepareCache: (tempPath: string) => void) => {
        const root = createTempDir(rootName);
        const csvDir = path.join(root, "csv");
        const schemaDir = path.join(root, "schema");
        const tempPath = path.join(root, "TempSaved/export-flow");
        const heroCsv = path.join(csvDir, "Hero.csv").replace(/\\/g, "/");
        const heroExtraCsv = path.join(csvDir, "HeroExtra.csv").replace(/\\/g, "/");
        const depCsv = path.join(csvDir, "Dep.csv").replace(/\\/g, "/");

        fileSeedData = [
            fileData(heroCsv, "hero-new"),
            fileData(heroExtraCsv, "extra-old"),
            fileData(depCsv, "dep-old"),
        ];
        prepareCache(tempPath);

        writeYaml(path.join(schemaDir, "Hero.yml"), [
            "type: data-table",
            "name: Shared",
            "key: id",
            "fields:",
            "  - name: id",
            "    type: int",
            "  - name: dep",
            "    type: DataTableKey",
            "    dataTableName: Dep",
            "    keyType: int",
        ].join("\n"));
        writeYaml(path.join(schemaDir, "HeroExtra.yml"), [
            "type: data-table",
            "name: SharedExtra",
            "key: id",
            "fields:",
            "  - name: id",
            "    type: int",
        ].join("\n"));
        writeYaml(path.join(schemaDir, "Dep.yml"), [
            "type: data-table",
            "name: Dep",
            "key: id",
            "fields:",
            "  - name: id",
            "    type: int",
        ].join("\n"));

        const result = await runPipeline(root, [
            "  - type: CodexIncrementalFileSeed",
            "    description: seed csv files",
            filterYaml.replaceAll("$tempPath", tempPath.replace(/\\/g, "/")),
            "  - type: GenerateSchema",
            "    description: generate schema after filter",
            "    extensions: [.yml]",
            "    targetMapping:",
            "      type: FindWithBaseName",
            `      targetDir: "${schemaDir.replace(/\\/g, "/")}"`,
        ].join("\n"));

        assert.deepEqual(result?.map((data) => (data as Schema).config.name).sort(), ["Dep", "Shared"]);

        await Manager.destroy();
        fs.rmSync(root, { recursive: true, force: true });
    };

    await runExpansionCase(
        "k-export-flow-increment-early-generate-schema-",
        [
            "  - type: EarlyFilterFilePathData",
            "    description: early filter before schema",
            "    tempPath: \"$tempPath\"",
        ].join("\n"),
        (tempPath) => {
            writeJson(path.join(tempPath, "export-csv-increment-info.json"), {
                "ExternalConfig/design-config/new_src/Hero.xlsx": "changed-hash",
            });
            writeJson(path.join(tempPath, "early-filter-file-path-data-info.json"), {
                version: 1,
                data: [
                    fileData("csv/Hero.csv", "hero-old"),
                    fileData("csv/HeroExtra.csv", "extra-old"),
                    fileData("csv/Dep.csv", "dep-old"),
                ],
            });
        },
    );

    await runExpansionCase(
        "k-export-flow-increment-filter-generate-schema-",
        [
            "  - type: FilterChangedFilePathData",
            "    description: filter changed csv before schema",
            "    tempPath: \"$tempPath\"",
            "    groupSetting: groups",
        ].join("\n"),
        (tempPath) => {
            writeJson(path.join(tempPath, "filter-changed-file-path-data-info.json"), {
                version: 1,
                data: [
                    fileData(path.join(path.dirname(tempPath), "..", "csv", "Hero.csv"), "hero-old"),
                    fileData(path.join(path.dirname(tempPath), "..", "csv", "HeroExtra.csv"), "extra-old"),
                    fileData(path.join(path.dirname(tempPath), "..", "csv", "Dep.csv"), "dep-old"),
                ],
            });
        },
    );
});

test("CollectChangedSchema: meta/schema 变更会扩散同组、DataTableKey 依赖和后处理依赖表", async () => {
    // 验证 BFS 精确扩散：仅 Hero source hash 变化时，通过 DataTableKey 和 readsTables 依赖传播到 Hero.extra、Item、Quest。
    // 使用全量先跑建立含 configHashes 的缓存，再修改单表触发真实增量，而非手写无 configHashes 的假缓存。
    initLocalization();
    const root = createTempDir("k-export-flow-increment-schema-");
    const tempPath = path.join(root, "TempSaved/export-flow");
    schemaSeedData = [
        createSchema("Hero", "battle/Hero.meta.yml", "hero-old", ["Item"]),
        createSchema("Hero", "battle/Hero.extra.meta.yml", "hero-extra-old"),
        createSchema("Item", "items/Item.meta.yml", "item-old"),
        createSchema("Quest", "quest/Quest.meta.yml", "quest-old"),
    ];
    const depsFile = writeYaml(path.join(root, "post-process-deps.yml"), [
        "version: 1",
        "globalProcessors:",
        "  - name: Quest",
        "    readsTables: [Hero, Item]",
    ].join("\n"));
    const registry = new PostProcessDependencyRegistry();
    registry.loadYamlDeclarations(depsFile);
    CollectChangedSchema.setDependencyRegistry(registry);

    const processorYaml = [
        "  - type: CodexIncrementalSchemaSeed",
        "    description: seed schemas",
        "  - type: CollectChangedSchema",
        "    description: collect changed schemas",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
    ].join("\n");

    // 全量运行建立含 configHashes 的缓存，确保后续增量运行只有真正变化的表被检出
    await runPipeline(root, processorYaml, new Map([["rootPath", root], ["incrementBuild", "false"]]));
    await Manager.getInstance().flushPendingCacheWrites();

    // 仅修改 Hero 的 source hash，触发 BFS 扩散：
    //   Hero 变更 → Quest（readsTables [Hero, Item]）→ Hero.extra（nameToSchema["Hero"] 指向最后一个同名）+ Item
    schemaSeedData[0] = createSchema("Hero", "battle/Hero.meta.yml", "hero-new", ["Item"]);
    const result = await runPipeline(root, processorYaml);

    assert.deepEqual(result?.map((data) => (data as Schema).config.name).sort(), ["Hero", "Hero", "Item", "Quest"]);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("CollectChangedSchema: 非增量或无旧缓存时全量通过，custom check 可模拟 TS 后处理变更", async () => {
    initLocalization();
    const root = createTempDir("k-export-flow-increment-schema-full-");
    const tempPath = path.join(root, "TempSaved/export-flow");
    schemaSeedData = [
        createSchema("Client", "client/Client.meta.yml", "client"),
        createSchema("Server", "server/Server.meta.yml", "server"),
    ];

    const processorYaml = [
        "  - type: CodexIncrementalSchemaSeed",
        "    description: seed schemas",
        "  - type: CollectChangedSchema",
        "    description: collect changed schemas",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
    ].join("\n");

    const fullResult = await runPipeline(root, processorYaml, new Map<string, string>([
        ["rootPath", root],
        ["incrementBuild", "false"],
    ]));
    assert.deepEqual(fullResult?.map((data) => (data as Schema).config.name).sort(), ["Client", "Server"]);

    await Manager.getInstance().flushPendingCacheWrites();
    registerCollectChangedSchemaCheckFunc((_oldData, newData) => newData.filter((data) => data.path.includes("Server")));
    const customResult = await runPipeline(root, processorYaml);
    assert.deepEqual(customResult?.map((data) => (data as Schema).config.name), ["Server"]);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("CollectChangedSchema: 缓存版本不一致时作废旧缓存并全量通过", async () => {
    initLocalization();
    const root = createTempDir("k-export-flow-increment-schema-cache-version-");
    const tempPath = path.join(root, "TempSaved/export-flow");
    schemaSeedData = [
        createSchema("Alpha", "version/Alpha.csv", "alpha-hash"),
        createSchema("Beta", "version/Beta.csv", "beta-hash"),
    ];

    const cachePath = path.join(tempPath, "filter-changed-schema.json");
    const processorYaml = [
        "  - type: CodexIncrementalSchemaSeed",
        "    description: seed schemas",
        "  - type: CollectChangedSchema",
        "    description: collect changed schemas",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
    ].join("\n");

    await runPipeline(root, processorYaml, new Map([["rootPath", root], ["incrementBuild", "false"]]));
    const savedCache = await flushAndReadJson<{ version?: number; data: unknown[] }>(cachePath);
    assert.equal(savedCache.version, COLLECT_CHANGED_SCHEMA_CACHE_VERSION);

    writeJson(cachePath, {
        ...savedCache,
        version: COLLECT_CHANGED_SCHEMA_CACHE_VERSION - 1,
    });

    const result = await runPipeline(root, processorYaml);
    assert.deepEqual(result?.map((d) => (d as Schema).config.name).sort(), ["Alpha", "Beta"]);

    const refreshedCache = await flushAndReadJson<{ version?: number; data: unknown[] }>(cachePath);
    assert.equal(refreshedCache.version, COLLECT_CHANGED_SCHEMA_CACHE_VERSION);

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

// ─── 回归测试：覆盖本次修复的三个 Bug ────────────────────────────────────────

test("CollectChangedSchema: 全量导出后 configHashes 被持久化，增量模式下 schema.config 变更（模拟 yml 修改）也能被检出", async () => {
    // Bug: configHash 计算位于早返回之后，全量导出写出的缓存中 configHashes 为空 {}。
    // 下次增量构建时所有 schema 的 oldConfigHash 均为 undefined，与新算出的 hash 不等，
    // 导致全部 schema 被标记为变更，无法收敛到真正的增量。
    initLocalization();
    const root = createTempDir("k-export-flow-increment-schema-confighash-persist-");
    const tempPath = path.join(root, "TempSaved/export-flow");

    const alphaPath = "persist/AlphaP.csv";
    const betaPath = "persist/BetaP.csv";
    schemaSeedData = [
        createSchema("Alpha", alphaPath, "alpha-hash"),
        createSchema("Beta", betaPath, "beta-hash"),
    ];

    const processorYaml = [
        "  - type: CodexIncrementalSchemaSeed",
        "    description: seed schemas",
        "  - type: CollectChangedSchema",
        "    description: collect changed schemas",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
    ].join("\n");

    // 第一次运行：全量导出（无缓存），应生成含 configHashes 的缓存
    await runPipeline(root, processorYaml, new Map([["rootPath", root], ["incrementBuild", "false"]]));
    const savedCache = await flushAndReadJson<{ version?: number; data: unknown[]; configHashes?: Record<string, string> }>(
        path.join(tempPath, "filter-changed-schema.json"),
    );

    assert.equal(savedCache.version, COLLECT_CHANGED_SCHEMA_CACHE_VERSION);
    // 全量导出必须持久化 configHashes；若失败则说明 configHash 计算仍在 early-exit 之后
    assert.ok(savedCache.configHashes?.[alphaPath], "全量导出应持久化 Alpha 的 configHash");
    assert.ok(savedCache.configHashes?.[betaPath], "全量导出应持久化 Beta 的 configHash");

    // 模拟 yml 变更：仅修改 Alpha 的 schema.config，source.hash 保持不变
    schemaSeedData[0].config.tag = "yml-modified";

    // 第二次运行：增量，仅 Alpha 的 configHash 发生变化，应只输出 Alpha
    const result = await runPipeline(root, processorYaml);
    assert.deepEqual(
        result?.map((d) => (d as Schema).config.name),
        ["Alpha"],
        "增量模式下仅 yml 变更的 schema 应被检出",
    );

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("CollectChangedSchema: 注册多个 customCheckFunc 时所有函数均被执行，结果合并而非互相覆盖", async () => {
    // Bug: customCheckFunc 为单一静态字段，后注册的函数会覆盖先注册的，
    // 导致多个注册者（如 IncrementCheck 和 registerTsHashCheck）只有最后一个生效。
    initLocalization();
    const root = createTempDir("k-export-flow-increment-schema-multi-check-");
    const tempPath = path.join(root, "TempSaved/export-flow");

    // 路径含 "AlphaM" / "BetaM"，与已注册过滤器（"Server" 等）不冲突
    schemaSeedData = [
        createSchema("Alpha", "multi/AlphaM.csv", "alpha-hash"),
        createSchema("Beta", "multi/BetaM.csv", "beta-hash"),
        createSchema("Gamma", "multi/GammaM.csv", "gamma-hash"),
    ];

    const processorYaml = [
        "  - type: CodexIncrementalSchemaSeed",
        "    description: seed schemas",
        "  - type: CollectChangedSchema",
        "    description: collect changed schemas",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
    ].join("\n");

    // 第一次运行：全量导出，写入 configHashes 缓存（确保增量运行时 hash 比对无变化）
    await runPipeline(root, processorYaml, new Map([["rootPath", root], ["incrementBuild", "false"]]));
    await Manager.getInstance().flushPendingCacheWrites();

    // 注册两个目标不同的检查函数
    registerCollectChangedSchemaCheckFunc((_old, newData) => newData.filter((d) => d.path.includes("AlphaM")));
    registerCollectChangedSchemaCheckFunc((_old, newData) => newData.filter((d) => d.path.includes("BetaM")));

    // 第二次运行：增量，source.hash 和 configHash 均无变化，仅由 customCheckFunc 贡献结果
    const result = await runPipeline(root, processorYaml);

    // 若后注册覆盖先注册（旧 Bug），result 只含 Beta；两者均应出现才证明 array 模式正确
    assert.deepEqual(
        result?.map((d) => (d as Schema).config.name).sort(),
        ["Alpha", "Beta"],
        "多个 customCheckFunc 应全部执行，结果合并",
    );

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("registerFilterChangedFilePathDataCheckFunc 注册的函数不影响仅含 CollectChangedSchema 的 Pipeline", async () => {
    // Bug: IncrementCheck.ts 曾错误地向 FilterChangedFilePathData 注册 yml hash 检查，
    // 而 FilterChangedFilePathData 不在 Pipeline 中，导致注册等同于死代码、yml 变更检测静默失效。
    // 本用例验证两个 Processor 的 customCheckFuncs 完全隔离，跨错处注册不产生任何副作用。
    initLocalization();
    const root = createTempDir("k-export-flow-increment-isolation-");
    const tempPath = path.join(root, "TempSaved/export-flow");

    // 使用独特路径避免与已注册函数（"Server"、"AlphaM"、"BetaM" 等）冲突
    schemaSeedData = [
        createSchema("PlanetX", "iso/PlanetX.csv", "px-hash"),
        createSchema("PlanetY", "iso/PlanetY.csv", "py-hash"),
    ];

    const processorYaml = [
        "  - type: CodexIncrementalSchemaSeed",
        "    description: seed schemas",
        "  - type: CollectChangedSchema",  // Pipeline 中只有 CollectChangedSchema
        "    description: collect changed schemas",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
    ].join("\n");

    // 第一次运行：全量导出，写入 configHashes 缓存
    await runPipeline(root, processorYaml, new Map([["rootPath", root], ["incrementBuild", "false"]]));
    await Manager.getInstance().flushPendingCacheWrites();

    // 向 FilterChangedFilePathData（不在 Pipeline 中）注册"返回全量"的检查函数
    registerFilterChangedFilePathDataCheckFunc((_old, newData) => newData);

    // 第二次运行：增量，source.hash 和 configHash 均无变化
    // FilterChangedFilePathData 的函数不在 CollectChangedSchema 的调用链中，结果应为空
    const result = await runPipeline(root, processorYaml);
    assert.deepEqual(
        result?.map((d) => (d as Schema).config.name),
        [],
        "注册到 FilterChangedFilePathData 的函数不应影响 CollectChangedSchema 的输出",
    );

    await Manager.destroy();
    fs.rmSync(root, { recursive: true, force: true });
});

test("CollectChangedSchema: csvGroups 触发时自动包含 readsTables，readsTables 触发时自动包含所有 csvGroups 文件", async () => {
    // Bug: csvGroups 和 readsTables 仅各自触发，不互相补全依赖，导致后处理器运行时 outputs 缺少所需数据。
    // 修复后：任一条件触发处理器，其全部依赖（readsTables + csvGroups 文件）都应加入本次 build。
    initLocalization();

    const zc01Path = "loc/ZH_CN/ZH_CN_01.csv";
    const zc02Path = "loc/ZH_CN/ZH_CN_02.csv";
    const langPath = "lang/Language.csv";
    const mapPath = "lang/Mapping.csv";

    const setupRegistryAndYaml = (root: string) => {
        const depsFile = writeYaml(path.join(root, "post-process-deps.yml"), [
            "version: 1",
            "globalProcessors:",
            "  - name: LocalizationGlobal",
            "    csvGroups:",
            "      - name: ZH_CN",
            "        includeRegex: [\"loc/ZH_CN/.+\\\\.csv$\"]",
            "    readsTables: [DTLanguage, DTMapping]",
        ].join("\n"));
        const reg = new PostProcessDependencyRegistry();
        reg.loadYamlDeclarations(depsFile);
        CollectChangedSchema.setDependencyRegistry(reg);
    };

    const buildProcessorYaml = (tempPath: string) => [
        "  - type: CodexIncrementalSchemaSeed",
        "    description: seed schemas",
        "  - type: CollectChangedSchema",
        "    description: collect changed schemas",
        `    tempPath: "${tempPath.replace(/\\/g, "/")}"`,
    ].join("\n");

    // ── Case 1: csvGroups 触发 → 应包含 readsTables 和同组其他 csvGroups 文件 ──
    {
        const root = createTempDir("k-export-flow-increment-postproc-csvtrigger-");
        const tempPath = path.join(root, "TempSaved/export-flow");
        setupRegistryAndYaml(root);

        schemaSeedData = [
            createSchema("ZH_CN_01", zc01Path, "zc01-v0"),
            createSchema("ZH_CN_02", zc02Path, "zc02-v0"),
            createSchema("DTLanguage", langPath, "lang-v0"),
            createSchema("DTMapping", mapPath, "map-v0"),
        ];
        const processorYaml = buildProcessorYaml(tempPath);

        // 全量运行建立含 configHashes 的缓存
        await runPipeline(root, processorYaml, new Map([["rootPath", root], ["incrementBuild", "false"]]));
        await Manager.getInstance().flushPendingCacheWrites();

        // 只改 ZH_CN_01 的 hash（匹配 csvGroups），其余不变
        schemaSeedData[0] = createSchema("ZH_CN_01", zc01Path, "zc01-v1");
        const result = await runPipeline(root, processorYaml);
        assert.deepEqual(
            result?.map((d) => (d as Schema).config.name).sort(),
            ["DTLanguage", "DTMapping", "ZH_CN_01", "ZH_CN_02"],
            "csvGroups 文件变更时应同时包含所有 readsTables 和同组其他 csvGroups 文件",
        );

        await Manager.destroy();
        fs.rmSync(root, { recursive: true, force: true });
    }

    // ── Case 2: readsTables 触发 → 应包含全部 csvGroups 文件和其余 readsTables ──
    {
        const root = createTempDir("k-export-flow-increment-postproc-tabletrigger-");
        const tempPath = path.join(root, "TempSaved/export-flow");
        setupRegistryAndYaml(root);

        schemaSeedData = [
            createSchema("ZH_CN_01", zc01Path, "zc01-v0"),
            createSchema("ZH_CN_02", zc02Path, "zc02-v0"),
            createSchema("DTLanguage", langPath, "lang-v0"),
            createSchema("DTMapping", mapPath, "map-v0"),
        ];
        const processorYaml = buildProcessorYaml(tempPath);

        // 全量运行建立缓存
        await runPipeline(root, processorYaml, new Map([["rootPath", root], ["incrementBuild", "false"]]));
        await Manager.getInstance().flushPendingCacheWrites();

        // 只改 DTLanguage 的 hash（在 readsTables 中），其余不变
        schemaSeedData[2] = createSchema("DTLanguage", langPath, "lang-v1");
        const result = await runPipeline(root, processorYaml);
        assert.deepEqual(
            result?.map((d) => (d as Schema).config.name).sort(),
            ["DTLanguage", "DTMapping", "ZH_CN_01", "ZH_CN_02"],
            "readsTables 中的表变更时应同时包含所有 csvGroups 文件和其余 readsTables",
        );

        await Manager.destroy();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
