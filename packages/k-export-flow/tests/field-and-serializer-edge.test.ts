import test from "node:test";
import assert from "node:assert/strict";

import {
    ArrayField,
    CustomFieldTextExporter,
    CustomFieldTextExporterHelper,
    EFieldType,
    Field,
    IntField,
    NumberValidator,
    Processor,
    SerializeContext,
    Serializer,
    StringReader,
    StructField,
    createDefaultGlobalConfig,
    parseLocalizationConfig,
    setGlobalConfig,
} from "../src/new";

import type { ICustomJsonTransformer } from "../src/new";
import type { IFieldOwner } from "../src/new";

class CodexFieldOwner implements IFieldOwner {
    public fields: Field[] = [];

    public addOwnedField(field: Field): void {
        this.fields.push(field);
    }
}

class CodexExporterProcessor extends Processor<CodexExporterProcessor> {
    protected processSingle(): undefined {
        return undefined;
    }
}

class CodexTextExporter extends CustomFieldTextExporter {
    public fieldType = "CodexCustomType";
    public exportedType = "CodexExportedType";
    public writes: string[] = [];

    public getJsonTransformer(): ICustomJsonTransformer {
        return {
            name: "CodexTextExporter",
            isApplicable: () => true,
            serialize: (v: unknown) => v,
            deserialize: (v: unknown) => v,
        };
    }

    public override onPreWriteFile(path: string, out: string[]): void {
        this.writes.push(path);
        out.push("// custom exporter touched");
    }
}

class CodexSerializer extends Serializer {
    public isReader(): boolean {
        return true;
    }

    public serialize<T>(v: T | undefined, defaultValue: T): T {
        return v ?? defaultValue;
    }

    public serializeArray<T>(v: T[] | undefined, defaultValue: T[] | undefined): T[] {
        return v ?? defaultValue ?? [];
    }

    public serializeMap<TKey, TValue>(v: Map<TKey, TValue> | undefined, defaultValue: Map<TKey, TValue> | undefined): Map<TKey, TValue> {
        return v ?? defaultValue ?? new Map();
    }

    public serializeStruct(v: object): unknown {
        return v;
    }

    public serializeOneOf(v: object): unknown {
        return v;
    }
}

function resetConfig(): void {
    const config = createDefaultGlobalConfig();
    setGlobalConfig(config);
    parseLocalizationConfig(config.localization);
}

test("Field factory covers type contexts, duplicate fields, and container creation errors", () => {
    resetConfig();
    const owner = new CodexFieldOwner();
    const context = Field.createContext();

    const structType = Field.createType({
        type: EFieldType.Struct,
        name: "CodexInlineStruct",
        fields: [{ name: "value", type: EFieldType.Int }],
    }, owner, context);
    assert.equal(Field.findType("CodexInlineStruct"), structType);
    assert.equal(Field.getAllTypeKeysInConfig().get("structs"), EFieldType.Struct);

    const structField = Field.create({ type: "CodexInlineStruct", name: "payload" }, owner);
    assert.equal(structField instanceof StructField, true);

    assert.throws(() => Field.createType({
        type: EFieldType.Struct,
        name: "CodexInlineStruct",
        fields: [],
    }, owner, context), /duplicated|重复|create-field-failed-with-duplicated-field/);

    assert.throws(() => Field.create({ type: EFieldType.Array, name: "badArray", alias: "badArray" }, owner), /array-inner-missing|inner 类型/);
    assert.throws(() => Field.create({
        type: EFieldType.Map,
        name: "badMap",
        alias: "badMap",
        innerKey: { name: "key", type: EFieldType.String },
    }, owner), /map-value-missing|value 类型/);
    assert.throws(() => Field.create({ type: "MissingStructType", name: "missingStruct" }, owner), /create-field-failed|MissingStructType/);

    const container = new ArrayField();
    const intField = new IntField();
    intField.config = { type: EFieldType.Int, name: "dup" };
    container.addOwnedField(intField);
    assert.throws(() => container.addOwnedField(intField), /add owned field failed/);

    Field.destroyContext(context);
});

test("CustomFieldTextExporter helper tracks used exporters and register failure path", () => {
    assert.throws(() => CodexTextExporter.register(CodexExporterProcessor), /not implemented/);

    const exporter = new CodexTextExporter();
    CustomFieldTextExporter.targetToExporters.set(CodexExporterProcessor, [exporter]);

    const processor = new CodexExporterProcessor();
    const helper = new CustomFieldTextExporterHelper(processor);
    assert.equal(helper.verifyExportType("Unknown"), undefined);
    assert.equal(helper.verifyExportType("CodexCustomType"), "CodexExportedType");

    const out: string[] = [];
    helper.onPreWriteFile("out.ts", out);
    assert.deepEqual(out, ["// custom exporter touched"]);
    assert.deepEqual(exporter.writes, ["out.ts"]);
});

test("Serializer base helpers preserve data and default primitive values", () => {
    const serializer = new CodexSerializer();
    serializer.setData({ ready: true });
    assert.deepEqual(serializer.getData<{ ready: boolean }>(), { ready: true });
    assert.equal(serializer.serializeNumber(undefined, { name: "n" }), 0);
    assert.equal(serializer.serializeNumber(undefined, { name: "n" }, 7), 7);
    assert.equal(serializer.serializeBigInt(undefined, { name: "b" }), 0n);
    assert.equal(serializer.serializeBigInt(undefined, { name: "b" }, 9n), 9n);
    assert.equal(serializer.serializeString(undefined, { name: "s" }), "");
    assert.equal(serializer.serializeString(undefined, { name: "s" }, "fallback"), "fallback");
    assert.equal(serializer.serializeBoolean(undefined, { name: "flag" }), false);
    assert.equal(serializer.serializeBoolean(undefined, { name: "flag" }, true), true);
    assert.equal(serializer.serializeNull(undefined, { name: "nil" }), null);
    assert.equal(serializer.serializeUndefined(undefined, { name: "none" }), undefined);
});

test("SerializeContext and primitive fields cover defaults, validators, declarations, and delayed creation", () => {
    resetConfig();
    const owner = new CodexFieldOwner();
    const reader = new StringReader();
    const context = new SerializeContext();
    context.init("CodexNamespace");
    context.newObjInfo("Root");

    const intField = Field.create({
        type: EFieldType.Int,
        name: "level",
        alias: "lv",
        default: 5,
        min: 1,
        max: 9,
    }, owner);
    reader.setData(undefined);
    assert.equal(intField.serializeValue(reader, undefined, context), 5);
    assert.equal(intField.getType(), EFieldType.Int);
    assert.match(intField.getDescription(), /level|int/);
    assert.equal(intField.hasValidator(NumberValidator), true);
    assert.deepEqual(intField.getConfig(), intField.config);
    assert.equal(intField.generateDeclaration(new Map()).type, EFieldType.Int);

    reader.setData("10");
    assert.throws(() => intField.serializeValue(reader, undefined, context), /validator-number-is-not-in-range|范围/);

    const boolField = Field.create({ type: EFieldType.Bool, name: "enabled", alias: "enabled", default: "true" }, owner);
    reader.setData(undefined);
    assert.equal(boolField.serializeValue(reader, undefined, context), true);

    const uintField = Field.create({ type: EFieldType.UInt, name: "count", alias: "count", min: -3 }, owner);
    reader.setData("0");
    assert.equal(uintField.serializeValue(reader, undefined, context), 0);

    const floatField = Field.create({ type: EFieldType.Float, name: "ratio", alias: "ratio", default: "1.5" }, owner);
    reader.setData(undefined);
    assert.equal(floatField.serializeValue(reader, undefined, context), 1.5);

    const bigIntField = Field.create({ type: EFieldType.BigInt, name: "huge", alias: "huge", default: "12" }, owner);
    reader.setData(undefined);
    assert.equal(bigIntField.serializeValue(reader, undefined, context), 12n);

    const arrayField = Field.create({
        type: EFieldType.Array,
        name: "ids",
        alias: "ids",
        inner: { type: EFieldType.Int },
    }, owner);
    reader.setData("1,2");
    assert.deepEqual(arrayField.serializeValue(reader, undefined, context), [1, 2]);

    const mapField = Field.create({
        type: EFieldType.Map,
        name: "scores",
        alias: "scores",
        innerKey: { type: EFieldType.String },
        innerValue: { type: EFieldType.Int },
    }, owner);
    reader.setData("a:1&b:2");
    assert.deepEqual(Array.from(mapField.serializeValue(reader, undefined, context) as Map<string, number>), [["a", 1], ["b", 2]]);

    context.pushInfo(intField, { lv: 5 }, "[0]");
    context.pushInfo(boolField, { enabled: true });
    assert.equal(context.currentField, boolField);
    assert.equal(context.currentExtraData, undefined);
    context.currentExtraData = "[enabled]";
    assert.equal(context.getCurrentDesc(), "Root.lv[0].enabled[enabled]");
    assert.equal(context.getInfo(), "");
    context.popInfo();
    context.currentField = intField;
    assert.equal(context.getCurrentDesc(), "Root.lv");
    context.currentField = undefined;
    assert.equal(context.getCurrentDesc(), "Root.");

    const delayed = Field.create({
        type: EFieldType.Array,
        name: "delayed",
        alias: "delayed",
    }, owner, undefined, true) as ArrayField;
    assert.equal(delayed.innerField, undefined);
    assert.throws(() => delayed.onCreate(), /array-inner-missing|inner/);

    const scratchContext = Field.createContext();
    Field.destroyContext({ types: new Map() });
    Field.destroyContext(scratchContext);
    assert.equal(Field.findType("NotRegisteredType"), undefined);
});

test("DataTableKeyField covers declaration, invalid config, array key compatibility, and ignored aliases", () => {
    resetConfig();
    const owner = new CodexFieldOwner();
    assert.throws(() => Field.create({
        type: EFieldType.DataTableKey,
        name: "missingKeyType",
        dataTableName: "AnyTable",
    }, owner), /data-table-key-type-missing|keyType|缺少数据表键值类型/);

    assert.throws(() => Field.create({
        type: EFieldType.DataTableKey,
        name: "badKeyType",
        dataTableName: "AnyTable",
        keyType: [EFieldType.Int],
    } as any, owner), /invalid data table key type/);

    const keyField = Field.create({
        type: EFieldType.DataTableKey,
        name: "ref",
        alias: "ref",
        optional: true,
        dataTableName: "AnyTable",
        keyType: EFieldType.String,
        ignoreKeyList: ["NONE"],
    }, owner);
    const declaration = keyField.generateDeclaration(new Map());
    assert.equal(declaration.type, EFieldType.String);
    assert.equal(declaration.optional, true);

    const reader = new StringReader();
    const context = new SerializeContext();
    context.init("CodexNamespace");
    reader.setData("NONE");
    assert.equal(keyField.serializeValue(reader, undefined, context), "NONE");
});
