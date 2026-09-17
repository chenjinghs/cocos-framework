import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    DataCache,
    DataPostProcess,
    DataTableSchema,
    DataWithSchema,
    ESchemaDataType,
    FieldDeclaration,
    TaggedInfoExtraData,
    addDataWithSchema,
    addExtraData,
    clearAllDeclaration,
    createDefaultGlobalConfig,
    deleteFieldDeclaration,
    deleteInterfaceDeclaration,
    deleteInterfaceFieldDeclaration,
    findDataWithSchema,
    getSchemaTargetMappingSource,
    getSchemaValueWithKey,
    getTargetPathWithMappingBySchemaKey,
    getDataTemplates,
    getFieldDeclaration,
    markDataWithSchemaToBeDeleted,
    parseLocalizationConfig,
    registerAllDataPostProcess,
    registerDataPostProcess,
    removeDataWithSchema,
    removeExtraData,
    removeFileAndVerifyDir,
    setAllFieldDeclarations,
    setCustomDeclaration,
    setFieldDeclaration,
    setGlobalConfig,
    setInterfaceDeclaration,
    setInterfaceFieldDeclaration,
} from "../src/new";

function initConfig(): void {
    const config = createDefaultGlobalConfig();
    setGlobalConfig(config);
    parseLocalizationConfig(config.localization);
}

async function createOutput(name: string, data: object = {}) {
    initConfig();
    const schema = new DataTableSchema();
    schema.config = {
        type: ESchemaDataType.DataTable,
        name,
        fields: [],
    };
    schema.schemaFiles = [`${name}.yml`];
    await schema.generateFields();
    return new DataWithSchema(data, schema);
}

test("schema util helpers find, add, remove, mutate declarations, and manage tagged extra data", async () => {
    const outputs = [await createOutput("CodexSchemaUtilA", { value: 1 })];

    assert.equal(findDataWithSchema(outputs, ESchemaDataType.DataTable, "CodexSchemaUtilA"), outputs[0]);
    assert.equal(findDataWithSchema(outputs, ESchemaDataType.Ini, "CodexSchemaUtilA"), undefined);

    const added = addDataWithSchema(outputs, ESchemaDataType.DataTable, "CodexSchemaUtilB", { value: 2 });
    assert.equal(outputs.includes(added), true);
    assert.equal(added.schema.declarationSet.custom, true);
    assert.deepEqual(getDataTemplates<Record<string, number>>(added), { value: 2 });

    setFieldDeclaration(added, "value", "number", false);
    assert.deepEqual(getFieldDeclaration(added, "value"), new FieldDeclaration("number", false));
    assert.equal(deleteFieldDeclaration(added, "value"), true);

    setAllFieldDeclarations(added, new Map([
        ["a", "number"],
        ["b", "string"],
    ]), new Set(["b"]));
    assert.equal(added.schema.declarationSet.fields.get("a")?.optional, false);
    assert.equal(added.schema.declarationSet.fields.get("b")?.optional, true);

    setInterfaceDeclaration(added, "ICodex", new Map([
        ["id", "number"],
    ]));
    assert.equal(setInterfaceFieldDeclaration(added, "ICodex", "name", "string", true), true);
    assert.equal(added.schema.declarationSet.interfaces.get("ICodex")?.fields.get("name")?.optional, true);
    assert.equal(deleteInterfaceFieldDeclaration(added, "ICodex", "id"), true);
    assert.equal(deleteInterfaceDeclaration(added, "ICodex"), true);
    assert.equal(setInterfaceFieldDeclaration(added, "Missing", "x", "number"), false);
    assert.equal(deleteInterfaceFieldDeclaration(added, "Missing", "x"), false);

    setCustomDeclaration(added, false);
    assert.equal(added.schema.declarationSet.custom, true);
    clearAllDeclaration(added);
    assert.equal(added.schema.declarationSet.fields.size, 0);
    assert.equal(added.schema.declarationSet.interfaces.size, 0);

    addExtraData(added, "export const A = 1;");
    addExtraData(added, ["export const B = 2;"]);
    assert.deepEqual(added.extraData.map((item) => (item as TaggedInfoExtraData).infos), [
        ["export const A = 1;"],
        ["export const B = 2;"],
    ]);
    removeExtraData(added);
    assert.deepEqual((added.extraData[0] as TaggedInfoExtraData).infos, ["export const B = 2;"]);

    markDataWithSchemaToBeDeleted(added);
    assert.equal(added.toBeDeleted, true);
    assert.equal(removeDataWithSchema(outputs, ESchemaDataType.DataTable, "CodexSchemaUtilB"), true);
    assert.equal(removeDataWithSchema(outputs, ESchemaDataType.DataTable, "CodexSchemaUtilB"), false);
});

test("processor util helpers resolve schema mapping, fake tables, post-process wrappers, and data cache", async () => {
    const output = await createOutput("CodexProcessorUtil", { nested: { value: 1 } });
    output.schema.config.outputMappingSource = "SourceConfig.yml";
    output.schema.config.clientPath = "client/SourceConfig.yml";
    output.schema.schemaFiles = ["FallbackConfig.yml"];

    assert.equal(getSchemaValueWithKey(output.schema, "clientPath"), "client/SourceConfig.yml");
    assert.equal(getSchemaTargetMappingSource(output.schema), "SourceConfig.yml");
    assert.deepEqual(await getTargetPathWithMappingBySchemaKey(output.schema, "clientPath", {
        type: "GenerateWithBaseName",
        targetDir: "generated",
        extension: ".json",
        resolvePath: false,
    }), [path.join("generated", "SourceConfig.json")]);
    await assert.rejects(
        () => getTargetPathWithMappingBySchemaKey(output.schema, "missingPath", {
            type: "GenerateWithBaseName",
            targetDir: "generated",
            extension: ".json",
            resolvePath: false,
        }),
        /invalid-param-in-schema-file|参数/,
    );

    const fake = await import("../src/new").then((mod) => mod.createFakeDataTable("CodexFake", "fake.yml", { ok: true }, "tag", { custom: 1 }));
    assert.equal(fake.schema.config.name, "CodexFake");
    assert.equal(fake.schema.config.tag, "tag");
    assert.equal(fake.sourcePath, "CodexFake");
    assert.deepEqual(fake.data, { ok: true });

    registerDataPostProcess("CodexProcessorUtilSingle", () => {});
    assert.equal(DataPostProcess.hasRegisteredDataPostProcess("CodexProcessorUtilSingle"), true);
    const allFunc = () => {};
    registerAllDataPostProcess("CodexProcessorUtilAll", allFunc);

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "k-export-flow-processor-util-"));
    const targetFile = path.join(root, "nested", "old.txt");
    fs.mkdirSync(path.dirname(targetFile), { recursive: true });
    fs.writeFileSync(targetFile, "old", "utf-8");
    await removeFileAndVerifyDir(targetFile);
    assert.equal(fs.existsSync(targetFile), false);
    assert.equal(fs.existsSync(path.dirname(targetFile)), true);

    const cache = DataCache.get();
    cache.clearAll();
    assert.equal(cache.fetch("missing"), undefined);
    const cached = { nested: { value: 1 } };
    cache.cache(cached, "a");
    const cloned = cache.fetch("a") as typeof cached;
    assert.deepEqual(cloned, cached);
    assert.notEqual(cloned, cached);
    const direct = cache.fetch("a", false);
    assert.equal(direct, cached);

    cache.cache({ drop: true }, "drop");
    cache.setUnused();
    assert.deepEqual(cache.fetch("a"), cached);
    cache.clearUnused();
    assert.equal(cache.fetch("drop"), undefined);
    assert.deepEqual(cache.fetch("a"), cached);

    cache.cache({ prefetched: true }, "prefetch");
    const originalLog = console.log;
    const logs: string[] = [];
    console.log = (message?: unknown) => {
        logs.push(String(message));
    };
    try {
        cache.preFetchAll();
    } finally {
        console.log = originalLog;
    }
    assert.match(logs.join("\n"), /pre-fetch cache time/);
    const prefetched = cache.fetch("prefetch");
    assert.deepEqual(prefetched, { prefetched: true });

    cache.clearAll();
    fs.rmSync(root, { recursive: true, force: true });
});
