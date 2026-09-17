import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DataPostProcess, PostProcessDependencyRegistry, registerAllDataPostProcess, registerDataPostProcess } from "../src/new";

function createTempDir(name: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function writeDepsYaml(root: string, fileName: string, body: string): string {
    const file = path.join(root, fileName);
    fs.writeFileSync(file, body, "utf-8");
    return file;
}

test("PostProcessDependencyRegistry loads YAML declarations and answers dependency queries", () => {
    const root = createTempDir("k-export-flow-deps-");
    const yamlPath = writeDepsYaml(root, "post-process-deps.yml", [
        "version: 1",
        "globalProcessors:",
        "  - name: Alpha",
        "    file: alpha.ts",
        "    description: Alpha processor",
        "    readsTables: [Beta, Gamma]",
        "    alwaysRun: true",
        "    csvGroups:",
        "      - name: alpha",
        "        includeRegex: [\"Alpha\\\\.csv$\"]",
        "  - name: Beta",
        "    readsTables: [Gamma]",
        "  - name: Gamma",
        "    readsTables: []",
    ].join("\n"));

    const registry = new PostProcessDependencyRegistry();
    registry.loadYamlDeclarations(yamlPath);
    registry.validateAndRegister("Alpha", "alpha.ts");

    assert.deepEqual(registry.getAllProcessors(), ["Alpha", "Beta", "Gamma"]);
    assert.deepEqual(Array.from(registry.getDependents("Gamma")).sort(), ["Alpha", "Beta"]);
    assert.equal(registry.isDeclared("Alpha", "Beta"), true);
    assert.equal(registry.isDeclared("Alpha", "Missing"), false);
    assert.equal(registry.hasAlwaysRun("Alpha"), true);
    assert.equal(registry.getProcessorFile("Alpha"), "alpha.ts");
    assert.deepEqual(registry.getProcessorNamesByFile("alpha.ts"), ["Alpha"]);
    assert.equal(registry.getProcessorTables("Alpha")?.join(","), "Beta,Gamma");
    assert.equal(registry.getProcessorCsvGroupRegexes("Alpha")?.[0].test("Alpha.csv"), true);
    assert.deepEqual(Array.from(registry.computeTransitiveClosure(new Set(["Gamma"]))).sort(), ["Beta", "Gamma"]);
    assert.match(registry.exportDependencyGraph(), /Alpha processor/);

    fs.rmSync(root, { recursive: true, force: true });
});

test("PostProcessDependencyRegistry validates YAML errors, missing declarations, pending files, and cycles", () => {
    const root = createTempDir("k-export-flow-deps-errors-");
    const invalidYaml = writeDepsYaml(root, "invalid.yml", "version: 1\n");
    const validYaml = writeDepsYaml(root, "valid.yml", [
        "version: 1",
        "globalProcessors:",
        "  - name: A",
        "    readsTables: [B]",
        "  - name: B",
        "    readsTables: [A]",
    ].join("\n"));

    const registry = new PostProcessDependencyRegistry();
    assert.throws(() => registry.loadYamlDeclarations(path.join(root, "missing.yml")), /not found/);
    assert.throws(() => registry.loadYamlDeclarations(invalidYaml), /missing globalProcessors/);
    assert.throws(() => registry.validateAndRegister("A"), /YAML declarations not loaded/);

    registry.loadYamlDeclarations(validYaml);
    assert.throws(() => registry.validateAndRegister("Missing"), /not declared in YAML/);
    assert.deepEqual(registry.detectCycles(), [["A", "B"]]);

    registerAllDataPostProcess("A", () => {});
    registry.loadPendingProcessorFiles();
    assert.equal(registry.getProcessorNamesByFile(registry.getProcessorFile("A") ?? "").includes("A"), true);

    fs.rmSync(root, { recursive: true, force: true });
});

test("DataPostProcess registration APIs expose single and all-processor registration state", () => {
    DataPostProcess.clearPendingProcessorFiles();
    registerDataPostProcess("CodexSinglePostProcess", () => {});
    assert.equal(DataPostProcess.hasRegisteredDataPostProcess("CodexSinglePostProcess"), true);

    registerAllDataPostProcess("CodexAllPostProcess", () => {});
    assert.equal(DataPostProcess.getPendingProcessorFiles().has("CodexAllPostProcess"), true);
    DataPostProcess.clearPendingProcessorFiles();
    assert.equal(DataPostProcess.getPendingProcessorFiles().size, 0);
});

test("registerSingleTableProcessor maps file→processor and adds a self-table without YAML declaration", () => {
    const root = createTempDir("k-export-flow-deps-single-");
    const yamlPath = writeDepsYaml(root, "post-process-deps.yml", [
        "version: 1",
        "globalProcessors:",
        "  - name: Alpha",
        "    readsTables: [Beta]",
    ].join("\n"));

    const registry = new PostProcessDependencyRegistry();
    registry.loadYamlDeclarations(yamlPath);

    // 单表后处理器未在 YAML 声明，注册后应建立 file→processor 映射，并把依赖表设为自身
    registry.registerSingleTableProcessor("DTNewCardPush", "single-table/active/DTNewCardPush.ts");
    assert.deepEqual(registry.getProcessorTables("DTNewCardPush"), ["DTNewCardPush"]);
    assert.deepEqual(registry.getProcessorNamesByFile("single-table/active/DTNewCardPush.ts"), ["DTNewCardPush"]);
    assert.equal(registry.getAllProcessorFiles().get("single-table/active/DTNewCardPush.ts")?.includes("DTNewCardPush"), true);

    // 不应覆盖 YAML 已声明处理器的 readsTables，且不引入自循环
    registry.registerSingleTableProcessor("Alpha", "alpha-extra.ts");
    assert.deepEqual(registry.getProcessorTables("Alpha"), ["Beta"]);
    assert.deepEqual(registry.detectCycles(), []);

    fs.rmSync(root, { recursive: true, force: true });
});

test("registerDataPostProcess tracks single-table processor file for incremental hash check", () => {
    DataPostProcess.clearPendingSingleTableFiles();

    // 单表注册时应捕获注册它的 TS 源文件并暂存（registry 未就绪场景）
    registerDataPostProcess("SingleTableTrackMe", () => {});
    const pending = DataPostProcess.getPendingSingleTableFiles();
    assert.equal(pending.has("SingleTableTrackMe"), true);
    const callerFile = pending.get("SingleTableTrackMe")!;
    assert.ok(callerFile.length > 0);

    const root = createTempDir("k-export-flow-deps-single-pending-");
    const yamlPath = writeDepsYaml(root, "post-process-deps.yml", [
        "version: 1",
        "globalProcessors:",
        "  - name: Alpha",
        "    readsTables: []",
    ].join("\n"));
    const registry = new PostProcessDependencyRegistry();
    registry.loadYamlDeclarations(yamlPath);

    // injectDependencyRegistry 阶段把暂存的单表文件同步进 registry
    registry.loadPendingProcessorFiles();
    assert.deepEqual(registry.getProcessorTables("SingleTableTrackMe"), ["SingleTableTrackMe"]);
    assert.equal(registry.getProcessorNamesByFile(callerFile).includes("SingleTableTrackMe"), true);
    assert.equal(DataPostProcess.getPendingSingleTableFiles().size, 0);

    fs.rmSync(root, { recursive: true, force: true });
});

test("loadAdditionalPostProcessReferences maps processor keys to referencing table csv basenames", () => {
    const root = createTempDir("k-export-flow-deps-refs-");
    // 单个引用形式 additionalDataPostProcess.key
    writeDepsYaml(root, "active_rank.yml", [
        "name: DTActiveRank",
        "additionalDataPostProcess:",
        "  key: EnumExporter",
        "  config: { enumName: RankType }",
    ].join("\n"));
    // 列表引用形式 additionalDataPostProcessList[].key
    writeDepsYaml(root, "skill_detail.yml", [
        "name: DTSkillDetail",
        "additionalDataPostProcessList:",
        "  - key: EnumExporter",
        "    config: { enumName: SkillType }",
        "  - key: ExportTemplateGroup",
        "    config: {}",
    ].join("\n"));
    // 无引用的配置应被忽略
    writeDepsYaml(root, "plain.yml", "name: DTPlain\nfields: []\n");

    const registry = new PostProcessDependencyRegistry();
    registry.loadAdditionalPostProcessReferences(root);

    // EnumExporter 被两张表引用，按 csv basename（小写）记录
    assert.deepEqual(Array.from(registry.getReferencingTableBaseNames("EnumExporter")).sort(), ["active_rank", "skill_detail"]);
    assert.deepEqual(Array.from(registry.getReferencingTableBaseNames("ExportTemplateGroup")), ["skill_detail"]);
    assert.equal(registry.getReferencingTableBaseNames("Nonexistent").size, 0);

    fs.rmSync(root, { recursive: true, force: true });
});
