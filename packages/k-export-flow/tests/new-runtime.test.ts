import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
    assert as exportedAssert,
    dataTable,
    everyTemplate,
    findTemplate,
    findTemplateWithCallback,
    getAllCustomData,
    getTemplate,
    getTemplateCount,
    foreachTemplate,
    P,
} from "../src";
import {
    AnyType,
    DataWithSchema,
    FilePathData,
    LastProcessorInputData,
    LastProcessorOutputData,
    OutputData,
    OutputExtraData,
    Schema,
    TemplateDeclarationSet,
    createDefaultGlobalConfig,
    getGlobalConfig,
    setGlobalConfig,
} from "../src/new";
import { fastHash } from "../src/new/misc/FastHash";
import { Registry } from "../src/new/misc/Registry";
import {
    convertMapToObject,
    convertObjWithMarker,
    copyDir,
    copyFile,
    createRegExpFromString,
    deepCopy,
    ensureDir,
    ensureFile,
    generateMD5,
    getErrorInfo,
    getExcelColumName,
    getFileBaseName,
    getFileExtension,
    loadBinaryFileData,
    loadTextFileData,
    md5File,
    md5FileSync,
    pathExists,
    registerCustomJsonType,
    rmPath,
    walkParallelPromise,
    writeFile,
} from "../src/new/misc/Util";

class CustomExtraData extends OutputExtraData {
    public constructor(public value: string) {
        super();
    }
}

function createTempDir(name: string): string {
    return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

test("global config factory clones defaults and guards unset access", () => {
    assert.throws(() => getGlobalConfig(), /there is no global config/);

    const first = createDefaultGlobalConfig();
    const second = createDefaultGlobalConfig();
    first.localization.type = "en-US";

    assert.equal(second.localization.type, "zh-CN");
    setGlobalConfig(first);
    assert.equal(getGlobalConfig().localization.type, "en-US");
});

test("runtime data objects expose descriptions, paths, payload, and extra data", () => {
    assert.equal(new AnyType().getDescription(), "AnyType");
    assert.equal(new LastProcessorInputData().getDescription(), "LastProcessorInputData");
    assert.equal(new LastProcessorOutputData().getDescription(), "LastProcessorOutputData");
    assert.equal(new FilePathData("table.csv", "hash").getDescription(), "table.csv");

    const output = new OutputData();
    const extra = new CustomExtraData("one");
    output.sourcePath = "source";
    output.targetPath = "target";
    output.setData({ id: 1 });
    output.addExtraData(extra);

    assert.equal(output.getSourcePath(), "source");
    assert.equal(output.getTargetPath(), "target");
    assert.deepEqual(output.getData(), { id: 1 });
    assert.equal(output.getDescription(), "OutputData");
    assert.equal(output.getExtraData(CustomExtraData), extra);

    output.removeExtraData(extra);
    assert.equal(output.getExtraData(CustomExtraData), undefined);

    const schema = new Schema();
    schema.config = { type: "data-table", name: "Demo", fields: [] };
    schema.schemaFiles = ["demo.yml"];
    schema.declarationSet = new TemplateDeclarationSet();
    const dataWithSchema = new DataWithSchema({ id: 1 }, schema);

    assert.equal(dataWithSchema.getSourcePath(), "Demo");
    assert.equal(dataWithSchema.getDescription(), "raw object of schema demo.yml");

    schema.source = new FilePathData("source.csv", "hash");
    assert.equal(dataWithSchema.getSourcePath(), "source.csv");

    assert.equal(schema.getConfig(), schema.config);
    assert.equal(schema.getDescription(), "schema demo.yml");
    assert.throws(() => schema.generateRawData({}, {} as any), /method not implemented/);
    schema.copyDeclaration(new Schema());
    schema.addOwnedField({} as any);
});

test("root package keeps editor-facing P namespace and fake runtime helpers", () => {
    exportedAssert(true, "ok");
    assert.throws(() => exportedAssert(false, "bad"), /bad/);
    assert.equal(P.FilePathData, FilePathData);
    assert.throws(() => dataTable(), /Method not implemented/);
    assert.throws(() => findTemplate("x"), /Method not implemented/);
    assert.throws(() => getTemplate("x"), /Method not implemented/);
    assert.throws(() => getTemplateCount(), /Method not implemented/);
    assert.throws(() => findTemplateWithCallback(() => true), /Method not implemented/);
    assert.throws(() => foreachTemplate(() => true), /Method not implemented/);
    assert.throws(() => everyTemplate(() => true), /Method not implemented/);
    assert.throws(() => getAllCustomData<unknown>(), /Method not implemented/);
});

test("Registry registers, creates, rejects duplicates, and resets registered constructors", () => {
    class Resettable {
        public static resetCount = 0;
        public static reset(): void {
            this.resetCount++;
        }
    }

    const key = `Resettable-${Date.now()}-${Math.random()}`;
    const registry = Registry.get(`registry-${key}`);
    registry.register(Resettable, key);

    assert.equal(registry.create<Resettable>(key) instanceof Resettable, true);
    assert.equal(registry.create<Resettable>("missing"), undefined);
    assert.throws(() => registry.register(Resettable, key), /register duplicated/);

    Registry.tryResetAll();
    assert.equal(Resettable.resetCount, 1);
});

test("misc pure helpers cover names, hashes, maps, objects, regexp, columns, and errors", () => {
    assert.equal(getFileExtension("role.data.csv"), ".csv");
    assert.equal(getFileBaseName("role.data.csv"), "role.data");
    assert.deepEqual(convertMapToObject(new Map<string, number>([["a", 1], ["b", 2]])), [["a", 1], ["b", 2]]);
    assert.deepEqual(convertObjWithMarker({ id: 1 }, "__extra__", "map"), { __extra__: "map", data: { id: 1 } });
    assert.deepEqual(deepCopy({ nested: { value: 1 } }), { nested: { value: 1 } });
    assert.equal(createRegExpFromString("/^abc$/i").test("ABC"), true);
    assert.equal(createRegExpFromString("abc").flags, "g");
    assert.equal(getExcelColumName(1), "A");
    assert.equal(getExcelColumName(26), "Z");
    assert.equal(getExcelColumName(27), "AA");
    assert.equal(getExcelColumName(703), "AAA");
    assert.equal(fastHash("same"), fastHash(Buffer.from("same")));
    assert.equal(generateMD5("same"), fastHash("same"));
    assert.equal(getErrorInfo(undefined), "none");
    assert.equal(getErrorInfo("plain"), "plain");
    assert.match(getErrorInfo(new Error("boom")), /boom/);
    assert.throws(() => registerCustomJsonType({ name: "x", isApplicable: () => true, serialize: (v: unknown) => v, deserialize: (v: unknown) => v }), /not implemented/);
});

test("misc file helpers cover async filesystem operations", async () => {
    const root = createTempDir("k-export-flow-util-");
    const sourceDir = path.join(root, "source");
    const nestedDir = path.join(sourceDir, "nested");
    const targetDir = path.join(root, "target");
    const textFile = path.join(nestedDir, "a.txt");
    const copiedFile = path.join(root, "copy", "a.txt");

    assert.equal(await pathExists(sourceDir), false);
    await ensureDir(nestedDir);
    await writeFile(textFile, "hello");
    await ensureFile(path.join(nestedDir, "empty.txt"));

    assert.equal(await pathExists(sourceDir), true);
    assert.equal(await loadTextFileData(textFile), "hello");
    assert.deepEqual(await loadBinaryFileData(textFile), Buffer.from("hello"));
    assert.equal(await md5File(textFile), md5FileSync(textFile));

    const walked = await walkParallelPromise(sourceDir);
    assert.deepEqual(walked.map((p) => path.basename(p)).sort(), ["a.txt", "empty.txt"]);

    await copyFile(textFile, copiedFile);
    assert.equal(fs.readFileSync(copiedFile, "utf-8"), "hello");

    await copyDir(sourceDir, targetDir);
    assert.equal(fs.readFileSync(path.join(targetDir, "nested", "a.txt"), "utf-8"), "hello");

    await rmPath(root);
    assert.equal(fs.existsSync(root), false);
});
