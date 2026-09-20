import assert from "node:assert/strict";
import { test } from "node:test";

import { TagHelper } from "../src/misc/TagHelper.js";

class C1 {}
class C2 {}
class C3 {}

test("addInfos:source 为空时返回 added 的副本,不与源数组共享引用", () => {
    let helper = new TagHelper();
    let source = [C1, C2];
    let merged = helper.addInfos<any>(undefined, source as any);

    assert.deepEqual(merged, [C1, C2]);
    assert.notEqual(merged, source, "不应直接把入参数组透出去");
});

test("addInfos:source 为空且 added 为单个时原样返回", () => {
    let helper = new TagHelper();
    assert.equal(helper.addInfos<any>(undefined, C1 as any), C1);
});

test("addInfos:added 为空时原样返回 source", () => {
    let helper = new TagHelper();
    assert.equal(helper.addInfos<any>(C1 as any, undefined), C1);
});

test("addInfos:单个 + 数组 应保留全部 ctor", () => {
    let helper = new TagHelper();
    // 回归:原实现用了非变异的 ret.concat(added) 且丢弃返回值,数组侧被静默吞掉
    assert.deepEqual(helper.addInfos<any>(C1 as any, [C2, C3] as any), [C1, C2, C3]);
});

test("addInfos:数组 + 数组 应保留全部 ctor", () => {
    let helper = new TagHelper();
    let merged = helper.addInfos<any>(undefined, [C1] as any);
    assert.deepEqual(helper.addInfos<any>(merged, [C2, C3] as any), [C1, C2, C3]);
});

test("addInfos:数组 + 单个 应保留全部 ctor", () => {
    let helper = new TagHelper();
    let merged = helper.addInfos<any>(undefined, [C1, C2] as any);
    assert.deepEqual(helper.addInfos<any>(merged, C3 as any), [C1, C2, C3]);
});
