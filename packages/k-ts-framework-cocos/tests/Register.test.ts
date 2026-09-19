import assert from "node:assert/strict";
import { test } from "node:test";

import { F } from "k-ts-framework";

import { registerAsyncLoadSubscriber } from "../src/AsyncLoad.js";
import { registerDelegateSubscriber } from "../src/DelegateEvent.js";
import { registerKFrameworkCocos } from "../src/index.js";

test("子注册器与总装配重复调用幂等，且装配结果完整可用", () => {
    // 消费项目可能先直接调子注册器、再由 KFrameworkBootstrap 调总装配：重复注册不得触发重复断言
    registerDelegateSubscriber();
    registerDelegateSubscriber();
    registerAsyncLoadSubscriber();
    registerAsyncLoadSubscriber();
    registerKFrameworkCocos();
    registerKFrameworkCocos();

    // 装配完整性可观测：NewByteArray 已注入（若中途断言失败留下半装配状态，此处不可用）
    let arr = F.Engine.NewByteArray();
    arr.Add(7);
    assert.equal(arr.Num(), 1);
    assert.equal(arr.Get(0), 7);
});
