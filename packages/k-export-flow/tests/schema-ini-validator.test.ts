import test from "node:test";
import assert from "node:assert/strict";

import {
    DataTableIniSchema,
    EFieldType,
    ESchemaDataType,
    EValidatorNumberType,
    FilePathData,
    IniSchema,
    SerializeContext,
    StringReader,
    Validator,
    createDefaultGlobalConfig,
    parseLocalizationConfig,
    setGlobalConfig,
} from "../src/new";

function initLocalization(): void {
    const config = createDefaultGlobalConfig();
    setGlobalConfig(config);
    parseLocalizationConfig(config.localization);
}

async function createIniSchema(): Promise<IniSchema> {
    initLocalization();
    const schema = new IniSchema();
    schema.config = {
        type: ESchemaDataType.Ini,
        name: "Settings",
        fields: [
            { name: "maxLevel", type: EFieldType.Int },
            { name: "title", type: EFieldType.String },
        ],
    };
    schema.source = new FilePathData("settings.ini", "hash");
    schema.schemaFiles = ["settings.yml"];
    await schema.generateFields();
    return schema;
}

async function createDataTableIniSchema(): Promise<DataTableIniSchema> {
    initLocalization();
    const schema = new DataTableIniSchema();
    schema.config = {
        type: ESchemaDataType.DataTableIni,
        name: "SettingsTable",
        key: "name",
        value: ["valueInt", "valueString"],
        fields: [
            { name: "maxLevel", type: EFieldType.Int },
            { name: "title", type: EFieldType.String },
        ],
    };
    schema.source = new FilePathData("settings.csv", "hash");
    schema.schemaFiles = ["settings-table.yml"];
    await schema.generateFields();
    return schema;
}

test("IniSchema serializes key-value rows and ignores comments, blanks, and unknown keys", async () => {
    const schema = await createIniSchema();
    const data = await schema.generateRawData([
        ["#comment", "ignored"],
        [],
        ["maxLevel", "42"],
        ["unknown", "ignored"],
        ["title", "Alpha"],
        ["empty", ""],
    ], new StringReader());

    assert.deepEqual(data, { maxLevel: 0, title: "" });
    await assert.rejects(() => schema.generateRawData({ maxLevel: 42 }, new StringReader()), /ini-error|data must be an array/);
});

test("DataTableIniSchema serializes keyed value columns and validates malformed input", async () => {
    const schema = await createDataTableIniSchema();
    const data = await schema.generateRawData([
        ["name", "valueInt", "valueString"],
        ["maxLevel", "42", undefined],
        ["title", undefined, "Alpha"],
        ["unknown", "100", undefined],
        ["#comment", "1", undefined],
        [],
    ], new StringReader());

    assert.deepEqual(data, { maxLevel: 42, title: "Alpha" });

    await assert.rejects(() => schema.generateRawData([], new StringReader()), /empty-line-in-ini|ini/);
    await assert.rejects(() => schema.generateRawData([
        ["name", "valueInt", "valueString"],
        ["maxLevel", "1", "duplicated"],
    ], new StringReader()), /duplicated-value-in-data-table-ini|ini/);
});

test("basic validators accept valid values and reject invalid values", () => {
    initLocalization();
    const context = new SerializeContext();
    context.init("ValidatorTest");

    const intValidator = Validator.create({
        type: "NumberValidator",
        numberType: EValidatorNumberType.Int,
        min: 1,
        max: 3,
    });
    assert.doesNotThrow(() => intValidator.validate(2, context));
    assert.throws(() => intValidator.validate(4, context), /validator-number-is-not-in-range|范围/);

    const uintValidator = Validator.create({
        type: "NumberValidator",
        numberType: EValidatorNumberType.UInt,
        min: -10,
        max: 2,
    });
    assert.doesNotThrow(() => uintValidator.validate(0, context));
    assert.throws(() => uintValidator.validate(-1, context), /validator-number-is-not-in-range|范围/);

    const floatValidator = Validator.create({
        type: "NumberValidator",
        numberType: EValidatorNumberType.Float,
        min: 0.5,
        max: 1.5,
    });
    assert.doesNotThrow(() => floatValidator.validate(1.25, context));

    const bigIntValidator = Validator.create({
        type: "BigIntValidator",
        min: 1n,
        max: 3n,
    });
    assert.doesNotThrow(() => bigIntValidator.validate(2n, context));
    assert.throws(() => bigIntValidator.validate(4n, context), /validator-bigint-is-not-in-range|范围/);

    const collectionValidator = Validator.create({
        type: "CollectionValidator",
        collection: ["A", "B"],
    });
    assert.doesNotThrow(() => collectionValidator.validate("A", context));
    assert.throws(() => collectionValidator.validate("C", context), /validator-value-is-not-in-collection|集合/);
    assert.throws(() => Validator.create({ type: "MissingValidator" }), /create-validator-failed|创建 validator 失败/);
});
