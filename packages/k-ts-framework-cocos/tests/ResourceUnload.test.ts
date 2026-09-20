import assert from "node:assert/strict";
import { test } from "node:test";

import { D, F } from "k-ts-framework";
import { cc } from "k-ts-framework-cocos";

import { ASYNC_LOAD_AND_INSTANTIATE, ASYNC_LOAD_SPRITE, registerAsyncLoadSubscriber } from "../src/AsyncLoad.js";

async function flushMacrotask() {
    // mock 加载链全部为 microtask，跑完一个 macrotask 回合即可确定性地全部排空
    await new Promise<void>((resolve) => {
        setImmediate(resolve);
    });
}

function presetPrefab(path: string, nodeName: string): void {
    let prefab = new cc.Prefab();
    prefab.data = new cc.Node(nodeName);
    cc.resources.setAssetForTest(path, prefab);
}

const createdSystems: ResUnloadSystem[] = [];

@D.system("ResUnloadTag")
class ResUnloadSystem extends F.System {
    public init(): void {
        createdSystems.push(this);
    }
}

test.before(() => {
    registerAsyncLoadSubscriber();
    F.System.createByTag("ResUnloadTag");
    assert.ok(createdSystems[0], "system 应已创建");
});

test("完成前取消:回调不触发、不挂节点、但已加载资产留在缓存(取消≠释放)", async () => {
    cc.assetManager.releaseAll();
    presetPrefab("ui/CancelProbe", "CancelProbe");

    let sys = createdSystems[0];
    let parent = new cc.Node("cancelParent");
    let called = false;
    let handle = sys.subscribe(ASYNC_LOAD_AND_INSTANTIATE, "ui/CancelProbe", "CancelProbe", parent, () => {
        called = true;
    });
    sys.unsubscribeWithHandle(handle); // 触发请求 Cancel
    await flushMacrotask();

    assert.equal(called, false, "取消后回调不应触发");
    assert.equal(parent.children.length, 0, "取消后不应实例化挂载节点");
    assert.equal(cc.assetManager.assets.has("ui/CancelProbe"), true, "底层加载照常完成并进缓存——取消的是请求,不是资源(释放须显式 releaseAsset)");
});

test("交付后取消:不追溯已交付结果", async () => {
    cc.assetManager.releaseAll();
    presetPrefab("ui/DeliverProbe", "DeliverProbe");

    let sys = createdSystems[0];
    let parent = new cc.Node("deliverParent");
    let delivered = false;
    let handle = sys.subscribe(ASYNC_LOAD_AND_INSTANTIATE, "ui/DeliverProbe", "DeliverProbe", parent, () => {
        delivered = true;
    });
    await flushMacrotask(); // 先交付
    assert.equal(delivered, true, "对照组:不取消时正常交付");

    sys.unsubscribeWithHandle(handle); // 交付后 Cancel
    assert.equal(parent.children.length, 1, "交付后取消不回收已挂载节点");
    assert.equal(parent.children[0].name, "DeliverProbe");
});

test("loadSpriteAsync 完成前取消:不创建/不赋值 Sprite", async () => {
    cc.assetManager.releaseAll();
    let frame = new cc.SpriteFrame();
    cc.resources.setAssetForTest("tex/CancelSprite", frame);

    let sys = createdSystems[0];
    let holder = new cc.Node("spriteHolder");
    let called = false;
    let handle = sys.subscribe(ASYNC_LOAD_SPRITE, "tex/CancelSprite", undefined, holder, () => {
        called = true;
    });
    sys.unsubscribeWithHandle(handle);
    await flushMacrotask();

    assert.equal(called, false);
    assert.equal(holder.getComponent(cc.Sprite), null, "取消后不应创建 Sprite 组件");
});
