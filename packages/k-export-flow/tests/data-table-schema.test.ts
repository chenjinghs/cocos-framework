import test from "node:test";
import assert from "node:assert/strict";

import {
    DataTableSchema,
    EDataTableKeyType,
    EFieldType,
    FilePathData,
    StringReader,
    createDefaultGlobalConfig,
    parseLocalizationConfig,
    setGlobalConfig,
} from "../src/new";

function createSchema(config: {
    name?: string;
    key?: string | string[];
    fields: Array<{ name: string; type: string; alias?: string; optional?: boolean }>;
    removeKeyInData?: boolean;
    removeEmptyValue?: boolean;
    startLineNumber?: number;
    keyNameLine?: number;
    dataStartLine?: number;
}): DataTableSchema {
    const globalConfig = createDefaultGlobalConfig();
    setGlobalConfig(globalConfig);
    parseLocalizationConfig(globalConfig.localization);
    const schema = new DataTableSchema();
    schema.config = {
        type: "data-table",
        name: config.name ?? "Demo",
        key: config.key,
        fields: config.fields,
        removeKeyInData: config.removeKeyInData,
        removeEmptyValue: config.removeEmptyValue,
        startLineNumber: config.startLineNumber,
        keyNameLine: config.keyNameLine,
        dataStartLine: config.dataStartLine,
    };
    schema.source = new FilePathData("demo.csv", "hash");
    schema.schemaFiles = ["demo.meta.yml"];
    return schema;
}

test("DataTableSchema exports array data when no key is configured and keeps raw row data", async () => {
    const schema = createSchema({
        fields: [
            { name: "id", type: EFieldType.Int },
            { name: "name", type: EFieldType.String },
            { name: "enabled", type: EFieldType.Bool },
        ],
    });
    await schema.generateFields();

    const data = await schema.generateRawData([
        ["id", "name", "enabled"],
        ["1", "hero", "true"],
        ["#skip", "ignored", "false"],
        [],
        ["2", "", "0"],
    ], new StringReader());

    assert.equal(schema.getKeyType(), EDataTableKeyType.Array);
    assert.deepEqual(data, [
        { id: 1, name: "hero", enabled: true },
        { id: 2, name: "", enabled: false },
    ]);

    const templates = data as object[];
    assert.deepEqual(schema.getTemplateRawData(templates[0]), { id: "1", name: "hero", enabled: "true" });
    assert.equal(schema.getKeyField()?.config.name, "index");
});

test("DataTableSchema exports single-key map, supports aliases, and can remove key from data", async () => {
    const schema = createSchema({
        key: "id",
        removeKeyInData: true,
        fields: [
            { name: "id", alias: "templateId", type: EFieldType.Int },
            { name: "title", type: EFieldType.String },
        ],
    });
    await schema.generateFields();

    const data = await schema.generateRawData([
        ["id", "title"],
        ["100", "alpha"],
        ["200", "beta"],
    ], new StringReader());

    assert.equal(schema.getKeyType(), EDataTableKeyType.Single);
    assert.deepEqual(Array.from((data as Map<number, object>).entries()), [
        [100, { templateId: undefined, title: "alpha" }],
        [200, { templateId: undefined, title: "beta" }],
    ]);
    assert.equal(schema.getKeyField()?.config.alias, "templateId");
});

test("DataTableSchema exports multi-key nested maps and reports duplicate keys", async () => {
    const schema = createSchema({
        key: ["group", "id"],
        fields: [
            { name: "group", type: EFieldType.String },
            { name: "id", type: EFieldType.Int },
            { name: "value", type: EFieldType.Float },
        ],
    });
    await schema.generateFields();

    const data = await schema.generateRawData([
        ["group", "id", "value"],
        ["a", "1", "1.5"],
        ["a", "2", "2.5"],
        ["b", "1", "3.5"],
    ], new StringReader());
    const root = data as Map<string, Map<number, object>>;

    assert.equal(schema.getKeyType(), EDataTableKeyType.Double);
    assert.deepEqual(root.get("a")?.get(1), { group: "a", id: 1, value: 1.5 });
    assert.deepEqual(root.get("a")?.get(2), { group: "a", id: 2, value: 2.5 });
    assert.deepEqual(root.get("b")?.get(1), { group: "b", id: 1, value: 3.5 });
    assert.equal(Array.isArray(schema.getKeyField()), true);

    await assert.rejects(
        () => schema.generateRawData([
            ["group", "id", "value"],
            ["a", "1", "1.5"],
            ["a", "1", "2.5"],
        ], new StringReader()),
        /duplicated-multi-key-in-data-table|重复多键值/,
    );
});

test("DataTableSchema honors line controls and removeEmptyValue", async () => {
    const schema = createSchema({
        key: "id",
        keyNameLine: 2,
        dataStartLine: 4,
        removeEmptyValue: true,
        fields: [
            { name: "id", type: EFieldType.Int },
            { name: "name", type: EFieldType.String },
            { name: "score", type: EFieldType.Int },
        ],
    });
    await schema.generateFields();

    const data = await schema.generateRawData([
        ["comment", "comment", "comment"],
        ["id", "name", "score"],
        ["ignored", "ignored", "ignored"],
        ["1", "alpha", undefined],
    ], new StringReader());

    assert.deepEqual(Array.from((data as Map<number, object>).entries()), [
        [1, { id: 1, name: "alpha" }],
    ]);
});

test("DataTableSchema validates empty data, missing keys, unsupported key types, and custom key mode", async () => {
    const emptySchema = createSchema({ fields: [{ name: "id", type: EFieldType.Int }] });
    await emptySchema.generateFields();
    await assert.rejects(() => emptySchema.generateRawData([], new StringReader()), /empty-line-in-data-table|无任何有效行/);

    const missingKeySchema = createSchema({
        key: "id",
        fields: [{ name: "id", type: EFieldType.Int }],
    });
    await missingKeySchema.generateFields();
    await assert.rejects(
        () => missingKeySchema.generateRawData([
            ["name"],
            ["alpha"],
        ], new StringReader()),
        /can-not-find-key-in-data-table|无法找到数据表键值/,
    );

    const unsupportedKeySchema = createSchema({
        key: "items",
        fields: [{
            name: "items",
            type: EFieldType.Array,
            optional: true,
        }],
    });
    unsupportedKeySchema.config.fields[0].inner = { name: "item", type: EFieldType.Int };
    await unsupportedKeySchema.generateFields();
    await assert.rejects(
        () => unsupportedKeySchema.generateRawData([
            ["items"],
            ["1,2"],
        ], new StringReader()),
        /data-table-key-type-is-not-supported|不支持的数据表键值类型/,
    );

    unsupportedKeySchema.setCustomKey();
    assert.equal(unsupportedKeySchema.getKeyType(), EDataTableKeyType.Custom);
    assert.equal(unsupportedKeySchema.getKeyField(), undefined);
});
