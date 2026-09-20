import assert from "node:assert/strict";
import { test } from "node:test";

import { cc } from "k-ts-framework-cocos";
import { loadAsset, releaseAsset } from "../src/ResourceUtil.js";

function presetJsonAsset(path: string, json: unknown): void {
    let asset = new cc.JsonAsset();
    asset.name = path;
    asset.json = json;
    cc.resources.setAssetForTest(path, asset);
}

/** 清空全局缓存,隔离各用例 */
function resetCache(): void {
    cc.assetManager.releaseAll();
}

test("load 后资产进入全局缓存(加载即缓存的基线)", async () => {
    resetCache();
    presetJsonAsset("data/release_a", { v: 1 });

    let asset = await loadAsset<InstanceType<typeof cc.JsonAsset>>("resources", "data/release_a");
    assert.deepEqual(asset.json, { v: 1 });
    assert.equal(cc.assetManager.assets.has(asset.uuid), true, "加载完成应能在 assetManager.assets 查到");
});

test("releaseAsset 真卸载:缓存逐出、refCount 不动、实例存活(引擎 3.8.8 实测语义)", async () => {
    resetCache();
    presetJsonAsset("data/release_b", { v: 2 });
    let asset = await loadAsset<InstanceType<typeof cc.JsonAsset>>("resources", "data/release_b");
    asset.addRef(); // 模拟使用方持有引用(如已实例化的节点)

    releaseAsset(asset);

    assert.equal(cc.assetManager.assets.has(asset.uuid), false, "释放后必须从缓存逐出——真卸载判据");
    assert.equal(asset.refCount, 1, "引擎语义:释放不减引用计数,持有方的引用不受影响");
    assert.equal(asset.isDestroyed, false, "仍有引用时实例不被销毁");
});

test("释放后重新 load:缓存重建,可再次正常使用", async () => {
    resetCache();
    presetJsonAsset("data/release_c", { v: 3 });
    let asset = await loadAsset<InstanceType<typeof cc.JsonAsset>>("resources", "data/release_c");
    releaseAsset(asset);
    assert.equal(cc.assetManager.assets.has(asset.uuid), false);

    let reloaded = await loadAsset<InstanceType<typeof cc.JsonAsset>>("resources", "data/release_c");
    assert.deepEqual(reloaded.json, { v: 3 });
    assert.equal(cc.assetManager.assets.has(reloaded.uuid), true, "重新加载后缓存应重建");
});

test("refCount 归零后 decRef 销毁实例:引用语义与缓存逐出相互独立", async () => {
    resetCache();
    presetJsonAsset("data/release_d", { v: 4 });
    let asset = await loadAsset<InstanceType<typeof cc.JsonAsset>>("resources", "data/release_d");
    asset.addRef();

    releaseAsset(asset);
    assert.equal(asset.isDestroyed, false, "缓存逐出不等于实例销毁");

    asset.decRef(); // 使用方释放自己的引用 → 归零
    assert.equal(asset.refCount, 0);
    asset.destroy();
    assert.equal(asset.isDestroyed, true);
});
