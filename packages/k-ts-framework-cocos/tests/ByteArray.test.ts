import assert from "node:assert/strict";
import { test } from "node:test";

import { newByteArray } from "../src/ByteArray.js";

test("newByteArray 全契约：Num/Add/Get/GetRef/Set/Contains/FindIndex/RemoveAt/IsValidIndex/Empty", () => {
    let arr = newByteArray();

    assert.equal(arr.Num(), 0);
    assert.ok(!arr.IsValidIndex(0));

    arr.Add(1);
    arr.Add(2);
    arr.Add(3);
    assert.equal(arr.Num(), 3);

    assert.equal(arr.Get(0), 1);
    assert.equal(arr.GetRef(2), 3);
    assert.equal(arr.Num(), 3, "Get/GetRef 不改变长度");

    arr.Set(1, 20);
    assert.equal(arr.Get(1), 20);

    assert.ok(arr.Contains(20));
    assert.ok(!arr.Contains(99));
    assert.equal(arr.FindIndex(3), 2);
    assert.equal(arr.FindIndex(99), -1);

    assert.ok(arr.IsValidIndex(0));
    assert.ok(arr.IsValidIndex(2));
    assert.ok(!arr.IsValidIndex(3));
    assert.ok(!arr.IsValidIndex(-1));
    assert.ok(!arr.IsValidIndex(1.5));

    arr.RemoveAt(0);
    assert.equal(arr.Num(), 2);
    assert.equal(arr.Get(0), 20, "RemoveAt 后后续元素前移");

    arr.Empty();
    assert.equal(arr.Num(), 0);
    assert.ok(!arr.IsValidIndex(0));
});

test("newByteArray 边界：越界访问/修改/删除抛错", () => {
    let arr = newByteArray();
    arr.Add(7);

    assert.throws(() => arr.Get(1), /out of range/);
    assert.throws(() => arr.Set(1, 0), /out of range/);
    assert.throws(() => arr.RemoveAt(-1), /out of range/);
    assert.equal(arr.Get(0), 7, "抛错后不破坏数据");
});
