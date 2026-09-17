import test from "node:test";
import assert from "node:assert/strict";

import {
    DataPostProcess,
    DataTableKeyField,
    DataTableSchema,
    DataWithSchema,
    EFieldType,
    FilePathData,
    Processor,
    StringReader,
    createDefaultGlobalConfig,
    parseLocalizationConfig,
    setGlobalConfig,
} from "../src/new";

function resetConfig() {
    const globalConfig = createDefaultGlobalConfig();
    setGlobalConfig(globalConfig);
    parseLocalizationConfig(globalConfig.localization);
    DataTableKeyField.reset();
}

function createSchema(name: string, config: Record<string, unknown>) {
    const schema = new DataTableSchema();
    schema.config = {
        type: "data-table",
        name,
        fields: [],
        ...config,
    } as DataTableSchema["config"];
    schema.source = new FilePathData(`${name}.csv`, "hash");
    schema.schemaFiles = [`${name}.meta.yml`];
    return schema;
}

async function runPostProcess(data: DataWithSchema[]) {
    const processor = Processor.create("PostProcess");
    assert.ok(processor);
    processor.config = {
        type: "PostProcess",
        description: "test post process",
    };
    return processor.processAll(data);
}

test("DataTableSchema serializes configured struct and oneof fields and generates nested declarations", async () => {
    resetConfig();
    const schema = createSchema("CodexStructOneOf", {
        structs: [{
            name: "CodexPosition",
            fields: [
                { name: "x", type: EFieldType.Int },
                { name: "y", alias: "yy", type: EFieldType.Int },
            ],
        }],
        oneofs: [{
            name: "CodexReward",
            alias: "CodexReward",
            key: { name: "kind", type: EFieldType.String },
            mapping: [
                { key: "item", type: EFieldType.Int, alias: "itemId" },
                { key: "text", type: EFieldType.String, alias: "text" },
            ],
        }],
        fields: [
            { name: "id", type: EFieldType.Int },
            { name: "position", alias: "pos", type: "CodexPosition" },
            { name: "reward", type: "CodexReward" },
        ],
    });
    await schema.generateFields();

    const data = await schema.generateRawData([
        ["id", "position", "reward"],
        ["1", "x:3|y:4|", "item|100"],
        ["2", "5|6", "text|hello"],
    ], new StringReader());

    assert.deepEqual(data, [
        { id: 1, pos: { x: 3, yy: 4 }, reward: { oneOfType: "itemId", itemId: 100 } },
        { id: 2, pos: { x: 5, yy: 6 }, reward: { oneOfType: "text", text: "hello" } },
    ]);

    const structDecl = schema.declarationSet.interfaces.get("CodexPosition");
    assert.ok(structDecl);
    assert.deepEqual(Array.from(structDecl.fields.keys()), ["x", "yy"]);

    const oneOfDecl = schema.declarationSet.interfaces.get("CodexReward");
    assert.ok(oneOfDecl);
    assert.equal(oneOfDecl.fields.get("itemId")?.optional, true);
    assert.equal(oneOfDecl.fields.get("text")?.optional, true);
});

test("DataTableKey fields verify aliases, replace them with real keys, and support ignored keys", async () => {
    resetConfig();

    const itemSchema = createSchema("CodexItemTable", {
        key: "id",
        keyAlias: "alias",
        fields: [
            { name: "id", type: EFieldType.Int },
            { name: "alias", type: EFieldType.String },
        ],
    });
    await itemSchema.generateFields();
    const itemData = await itemSchema.generateRawData([
        ["id", "alias"],
        ["101", "sword"],
    ], new StringReader());

    const lootSchema = createSchema("CodexLootTable", {
        key: "id",
        fields: [
            { name: "id", type: EFieldType.Int },
            {
                name: "itemAlias",
                type: EFieldType.DataTableKey,
                dataTableName: "CodexItemTable",
                keyType: EFieldType.Int,
                useKeyAlias: true,
            },
            {
                name: "optionalItem",
                type: EFieldType.DataTableKey,
                dataTableName: "MissingButIgnored",
                keyType: EFieldType.Int,
                ignoreKeyList: [0],
            },
        ],
    });
    await lootSchema.generateFields();
    const lootData = await lootSchema.generateRawData([
        ["id", "itemAlias", "optionalItem"],
        ["1", "sword", "0"],
    ], new StringReader());

    const lootBeforePostProcess = (lootData as Map<number, Record<string, unknown>>).get(1)!;
    assert.equal(typeof lootBeforePostProcess.itemAlias, "symbol");
    assert.equal(lootBeforePostProcess.optionalItem, 0);

    const itemOutput = new DataWithSchema(itemData, itemSchema);
    const lootOutput = new DataWithSchema(lootData, lootSchema);
    await runPostProcess([itemOutput, lootOutput]);

    const lootAfterPostProcess = (lootOutput.data as Map<number, Record<string, unknown>>).get(1)!;
    assert.deepEqual(lootAfterPostProcess, { id: 1, itemAlias: 101, optionalItem: 0 });
    assert.equal(DataPostProcess.hasRegisteredDataPostProcess("ValidatorGlobal"), false);
});

test("DataTableKey fields reject missing target table names and invalid key types", async () => {
    resetConfig();

    const missingTableNameSchema = createSchema("CodexMissingTableName", {
        fields: [{
            name: "ref",
            type: EFieldType.DataTableKey,
            keyType: EFieldType.Int,
        }],
    });
    await missingTableNameSchema.generateFields();
    await assert.rejects(
        () => missingTableNameSchema.generateRawData([
            ["ref"],
            ["1"],
        ], new StringReader()),
        /validator-missing-param|dataTableName/,
    );

    const invalidKeyTypeSchema = createSchema("CodexInvalidKeyType", {
        fields: [{
            name: "ref",
            type: EFieldType.DataTableKey,
            dataTableName: "AnyTable",
            keyType: EFieldType.Bool,
        }],
    });
    await assert.rejects(
        () => invalidKeyTypeSchema.generateFields(),
        /data-table-key-type-is-not-supported|不支持/,
    );
});

test("DataTableSchema preprocesses combinable array, map, struct, and oneof columns", async () => {
    resetConfig();
    const schema = createSchema("CodexCombinable", {
        structs: [{
            name: "CodexAttrs",
            fields: [
                { name: "atk", type: EFieldType.Int },
                { name: "hp", type: EFieldType.Int },
            ],
        }],
        oneofs: [{
            name: "CodexAction",
            alias: "CodexAction",
            mapping: [
                { key: "damage", type: EFieldType.Int, alias: "damage" },
                { key: "talk", type: EFieldType.String, alias: "talk" },
            ],
        }],
        fields: [
            { name: "id", type: EFieldType.Int },
            { name: "rewards", type: EFieldType.Array, combinable: true, inner: { name: "reward", type: EFieldType.Int } },
            {
                name: "prices",
                type: EFieldType.Map,
                combinable: true,
                innerKey: { name: "Key", type: EFieldType.String },
                innerValue: { name: "Value", type: EFieldType.Int },
            },
            { name: "attrs", type: "CodexAttrs", combinable: true },
            { name: "action", type: "CodexAction", combinable: true },
        ],
    });
    await schema.generateFields();

    const data = await schema.generateRawData([
        [
            "id",
            "rewards_1",
            "rewards_2",
            "prices_Key1",
            "prices_Value1",
            "attrs_atk",
            "attrs_hp",
            "action_oneOfType",
            "action_param_1",
        ],
        ["1", "10", "20", "gold", "99", "7", "88", "damage", "123"],
    ], new StringReader());

    assert.deepEqual(data, [{
        id: 1,
        rewards: [10, 20],
        prices: new Map([["gold", 99]]),
        attrs: { atk: 7, hp: 88 },
        action: { oneOfType: "damage", damage: 0 },
    }]);
});

test("DataTableSchema applies explicit defaults to empty combinable array columns", async () => {
    resetConfig();
    const schema = createSchema("CodexCombinableArrayDefault", {
        fields: [
            { name: "id", type: EFieldType.Int },
            {
                name: "values",
                type: EFieldType.Array,
                combinable: true,
                inner: { name: "value", type: EFieldType.Int, default: 0 },
            },
        ],
    });
    await schema.generateFields();

    const data = await schema.generateRawData([
        ["id", "values_1", "values_2", "values_3"],
        ["1", "", "2", ""],
        ["2", "", "", ""],
    ], new StringReader());

    assert.deepEqual(data, [
        { id: 1, values: [0, 2, 0] },
        { id: 2, values: [0, 0, 0] },
    ]);
});
