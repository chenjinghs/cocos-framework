import assert from "node:assert/strict";
import { test } from "node:test";

import { F } from "k-ts-framework";
import { cc } from "../src/cc";
import { registerKFrameworkCocos } from "../src/index";

test("registerKFrameworkCocos 装配后 F.Engine.NewByteArray 可用", () => {
    registerKFrameworkCocos();

    let arr = F.Engine.NewByteArray();
    arr.Add(65);
    arr.Add(66);
    assert.equal(arr.Num(), 2);
    assert.equal(arr.Get(1), 66);
});

test("registerKFrameworkCocos 装配后 F.Engine.readTextFile 调到 cc 实现（resources 缓存路径）", () => {
    registerKFrameworkCocos();

    let textAsset = new cc.TextAsset();
    textAsset.text = '{"a":1}';
    cc.resources.setAssetForTest("config/game", textAsset);

    // 带扩展名的路径会被 normalize 后命中缓存
    assert.equal(F.Engine.readTextFile("config/game.json"), '{"a":1}');
});

test("readTextFile 未命中缓存时抛错（非 jsb 运行时外抛模式）", () => {
    registerKFrameworkCocos();
    assert.throws(() => F.Engine.readTextFile("config/not_exist.json"), /unavailable/);
});
