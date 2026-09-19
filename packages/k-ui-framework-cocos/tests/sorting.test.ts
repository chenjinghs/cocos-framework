import assert from "node:assert/strict";
import { test } from "node:test";

import { cc } from "k-ts-framework-cocos";
import { findWnd, openWnd, UIEngineInterface } from "k-ui-framework";

import { attachUIRootToScene, registerCocosUI, registerCocosUITemplate } from "../src/index.js";

function setupSceneWithCanvas() {
    let scene = new cc.Scene("TestScene");
    cc.director.currentScene = scene;

    let canvas = new cc.Node("Canvas");
    canvas.addComponent(cc.Canvas);
    scene.addChild(canvas);
}

function preloadWndPrefab(uiTag: string) {
    let prefab = new cc.Prefab();
    let node = new cc.Node(uiTag);
    node.addChild(new cc.Node("content"));
    prefab.data = node;
    cc.resources.setAssetForTest(`ui/${uiTag}`, prefab);
}

async function flushMacrotask() {
    // mock 加载链全部为 microtask，跑完一个 macrotask 回合即可确定性地全部排空
    await new Promise<void>((resolve) => {
        setImmediate(resolve);
    });
}

test("_modifySortingOrder 按权重升序重排 siblingIndex，同值保持现有相对顺序", async () => {
    setupSceneWithCanvas();
    registerCocosUI();
    registerCocosUITemplate("SortA", { wnd: { wndLayer: 1 } });
    registerCocosUITemplate("SortB", { wnd: { wndLayer: 1 } });
    preloadWndPrefab("SortA");
    preloadWndPrefab("SortB");

    openWnd("SortA");
    openWnd("SortB");
    await flushMacrotask();

    let uiRoot = attachUIRootToScene();
    let wndA = findWnd("SortA");
    let wndB = findWnd("SortB");
    assert.ok(wndA && wndB, "两个窗口都应已创建");

    let nodeA = UIEngineInterface._findUIRes<cc.Node>(wndA);
    let nodeB = UIEngineInterface._findUIRes<cc.Node>(wndB);
    assert.ok(nodeA && nodeB, "两个窗口资源都应已加载");

    // 同 layer 内按打开顺序分配权重：A 先 B 后
    assert.deepEqual(
        uiRoot.children.map((v) => v.name),
        ["SortA", "SortB"],
    );

    // 提高 A 的权重超过 B（核心分配权重 = layer*1000 + 序*10，B 为 1010）→ A 挪到 B 之后
    UIEngineInterface._modifySortingOrder(wndA, 5000);
    assert.deepEqual(
        uiRoot.children.map((v) => v.name),
        ["SortB", "SortA"],
    );
    assert.ok(nodeA.getSiblingIndex() > nodeB.getSiblingIndex());

    // 同值时保持现有相对顺序（稳定排序）：先降 B（不破坏 [B,A]），再降 A 到同值，顺序应仍为 B 前 A 后
    UIEngineInterface._modifySortingOrder(wndB, 5);
    assert.deepEqual(
        uiRoot.children.map((v) => v.name),
        ["SortB", "SortA"],
    );
    UIEngineInterface._modifySortingOrder(wndA, 5);
    assert.deepEqual(
        uiRoot.children.map((v) => v.name),
        ["SortB", "SortA"],
    );
});
