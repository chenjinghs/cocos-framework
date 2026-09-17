import test from "node:test";
import assert from "node:assert/strict";

import { StringReader } from "../src/new";
import { createDefaultGlobalConfig, setGlobalConfig } from "../src/new/data/Define";

const reader = new StringReader();

function config(name: string) {
    return { name };
}

test("StringReader serializes primitive values with defaults, optional, required, and precision", () => {
    setGlobalConfig(createDefaultGlobalConfig());

    reader.setData(undefined);
    assert.equal(reader.serialize(undefined, 7, config("num")), 7);
    assert.equal(reader.serialize(undefined, 7, { name: "num", optional: true }), undefined);
    assert.throws(() => reader.serialize(undefined, 7, { name: "num", required: true }), /string-reader-read-failed-with-invalid-data/);

    reader.setData("");
    assert.equal(reader.serialize("", "fallback", config("str")), "fallback");
    assert.equal(reader.serialize("", "fallback", { name: "str", optional: true }), undefined);

    reader.setData("1.23456");
    assert.equal(reader.serialize(undefined, 0, { name: "float", precision: 2 }), 1.23);

    reader.setData("abc");
    assert.throws(() => reader.serialize(undefined, 0, config("bad-number")), /invalid-number-value abc/);

    reader.setData("9007199254740993");
    assert.equal(reader.serialize(undefined, 0n, config("big")), 9007199254740993n);

    reader.setData("false");
    assert.equal(reader.serialize(undefined, true, config("bool")), false);
    reader.setData("0");
    assert.equal(reader.serialize(undefined, true, config("bool")), false);
    reader.setData("1");
    assert.equal(reader.serialize(undefined, false, config("bool")), true);

    reader.setData(42);
    assert.equal(reader.serialize(undefined, 0, config("already-number")), 42);

    reader.setData("anything");
    assert.equal(reader.serialize(undefined, null, config("null")), null);
    assert.equal(reader.serialize(undefined, undefined, config("undefined")), undefined);
    assert.throws(() => reader.serialize(undefined, {} as any, config("invalid-default")), /invalid-value-type-in-string-reader/);
});

test("StringReader serializes arrays from strings and arrays", () => {
    setGlobalConfig(createDefaultGlobalConfig());

    reader.setData("1,2,3,");
    assert.deepEqual(reader.serializeArray<number>(undefined, [], config("arr"), (sr) => sr.serializeNumber(undefined, config("item"))), [1, 2, 3]);

    reader.setData(["a", "b"]);
    assert.deepEqual(reader.serializeArray<string>(undefined, [], config("arr"), (sr) => sr.serializeString(undefined, config("item"))), ["a", "b"]);

    reader.setData("");
    assert.deepEqual(reader.serializeArray<string>(undefined, ["fallback"], config("arr"), (sr) => sr.serializeString(undefined, config("item"))), ["fallback"]);
    assert.equal(reader.serializeArray<string>(undefined, [], { name: "arr", optional: true }, (sr) => sr.serializeString(undefined, config("item"))), undefined);
    assert.throws(
        () => reader.serializeArray<string>(undefined, [], { name: "arr", required: true }, (sr) => sr.serializeString(undefined, config("item"))),
        /string-reader-read-failed-with-invalid-data/,
    );

    reader.setData("   ");
    assert.deepEqual(reader.serializeArray<string>(undefined, [], config("arr"), (sr) => sr.serializeString(undefined, config("item"))), []);
    assert.equal(reader.serializeArray<string>(undefined, [], { name: "arr", optional: true }, (sr) => sr.serializeString(undefined, config("item"))), undefined);
});

test("StringReader serializes maps and rejects invalid or duplicate elements", () => {
    setGlobalConfig(createDefaultGlobalConfig());

    reader.setData("a:1&b:2&");
    const map = reader.serializeMap<string, number>(
        undefined,
        new Map<string, number>(),
        config("map"),
        (sr) => sr.serializeString(undefined, config("key")),
        (sr) => sr.serializeNumber(undefined, config("value")),
    );
    assert.deepEqual(Array.from(map), [["a", 1], ["b", 2]]);

    reader.setData([["x", "3"]]);
    const arrayMap = reader.serializeMap<string, number>(
        undefined,
        new Map<string, number>(),
        config("map"),
        (sr) => sr.serializeString(undefined, config("key")),
        (sr) => sr.serializeNumber(undefined, config("value")),
    );
    assert.deepEqual(Array.from(arrayMap), [["x", 3]]);

    reader.setData("bad");
    assert.throws(
        () => reader.serializeMap<string, number>(undefined, new Map(), config("map"), (sr) => sr.serializeString(undefined, config("key")), (sr) => sr.serializeNumber(undefined, config("value"))),
        /invalid-map-element/,
    );

    reader.setData("a:1&a:2");
    assert.throws(
        () => reader.serializeMap<string, number>(undefined, new Map(), config("map"), (sr) => sr.serializeString(undefined, config("key")), (sr) => sr.serializeNumber(undefined, config("value"))),
        /duplicate-map-key/,
    );

    reader.setData("   ");
    assert.deepEqual(Array.from(reader.serializeMap<string, number>(undefined, new Map(), config("map"), (sr) => sr.serializeString(undefined, config("key")), (sr) => sr.serializeNumber(undefined, config("value")))), []);
    assert.equal(reader.serializeMap<string, number>(undefined, new Map(), { name: "map", optional: true }, (sr) => sr.serializeString(undefined, config("key")), (sr) => sr.serializeNumber(undefined, config("value"))), undefined);
});

test("StringReader serializes structs with named and positional elements", () => {
    setGlobalConfig(createDefaultGlobalConfig());

    reader.setData("id:1|name:hero|");
    const named = reader.serializeStruct(
        {},
        {},
        config("struct"),
        (_sr, name) => String(name),
        (sr, key) => key === "id" ? sr.serializeNumber(undefined, config(key)) : sr.serializeString(undefined, config(key)),
    );
    assert.deepEqual(named, { id: 1, name: "hero" });

    reader.setData(["10", ["name", "mage"]]);
    const positional = reader.serializeStruct(
        {},
        {},
        config("struct"),
        (_sr, name) => String(name),
        (sr, key) => key === "0" ? sr.serializeNumber(undefined, config(key)) : sr.serializeString(undefined, config(key)),
    );
    assert.deepEqual(positional, { 0: 10, name: "mage" });

    reader.setData("id:1|id:2");
    assert.throws(
        () => reader.serializeStruct({}, {}, config("struct"), (_sr, name) => String(name), (sr) => sr.serializeNumber(undefined, config("value"))),
        /duplicate-object-key/,
    );
});

test("StringReader serializes oneof values and validates element count", () => {
    setGlobalConfig(createDefaultGlobalConfig());

    reader.setData("int|42");
    const oneOf = reader.serializeOneOf(
        {},
        {},
        config("oneOf"),
        () => "type",
        (sr) => sr.serializeString(undefined, config("type")),
        (_sr, typeValue) => typeValue === "int" ? "intValue" : "stringValue",
        (sr, key) => key === "intValue" ? sr.serializeNumber(undefined, config(key)) : sr.serializeString(undefined, config(key)),
    );
    assert.deepEqual(oneOf, { type: "int", intValue: 42 });

    reader.setData("too|many|parts");
    assert.throws(
        () => reader.serializeOneOf({}, {}, config("oneOf"), () => "type", (sr) => sr.serializeString(undefined, config("type")), () => "value", (sr) => sr.serializeString(undefined, config("value"))),
        /invalid-oneof-data/,
    );
});
