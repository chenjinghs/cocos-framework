import assert from "node:assert/strict";
import { test } from "node:test";

import { D, F } from "k-ts-framework";
import { cc } from "k-ts-framework-cocos";
import { closeWnd, findWnd, OnWidgetBoundSEvent, OnWidgetUnboundSEvent, openWnd } from "k-ui-framework";

import { registerCocosUI, registerCocosUITemplate } from "../src/index.js";

function setupSceneWithCanvas() {
    let scene = new cc.Scene("WndUnloadScene");
    cc.director.currentScene = scene;

    let canvas = new cc.Node("Canvas");
    canvas.addComponent(cc.Canvas);
    scene.addChild(canvas);
}

async function flushMacrotask() {
    await new Promise<void>((resolve) => {
        setImmediate(resolve);
    });
}

let boundWidget: cc.Node | undefined;
let unboundCount = 0;

@D.store()
class WndLogicStore extends F.Store {}

@D.system("WndUnloadCaptureTag")
class WndUnloadCaptureSystem extends F.System {
    public init(): boolean {
        this.subscribe(WndLogicStore, OnWidgetBoundSEvent, (event: InstanceType<typeof OnWidgetBoundSEvent>) => {
            boundWidget = event.widget as cc.Node;
        });
        this.subscribe(WndLogicStore, OnWidgetUnboundSEvent, () => {
            unboundCount++;
        });
        return true;
    }
}

function preloadWndPrefab(tag: string) {
    let prefab = new cc.Prefab();
    prefab.data = new cc.Node(`Wnd_${tag}`);
    cc.resources.setAssetForTest(`ui/${tag}`, prefab);
}

test("closeWnd 全链路:store 树销毁 + 面板节点销毁 + Unbound 事件送达逻辑子 store", async () => {
    setupSceneWithCanvas();
    registerCocosUI();
    F.System.createByTag("WndUnloadCaptureTag");
    registerCocosUITemplate("WndClose", { wnd: { wndLayer: 1 } });
    preloadWndPrefab("WndClose");

    openWnd("WndClose");
    const wnd = findWnd("WndClose");
    assert.ok(wnd, "openWnd 后 wnd store 应同步存在");

    // 绑定完成前挂逻辑 store,装饰器订阅才生效(同 bindChildren 测试时序)
    WndLogicStore.create(wnd);
    await flushMacrotask();
    await flushMacrotask();

    assert.ok(boundWidget, "OnWidgetBoundSEvent 应送达(时序对照组)");
    assert.equal(boundWidget!.isDestroyed, false, "开着时面板节点存活");

    let unboundBefore = unboundCount;
    closeWnd("WndClose");
    await flushMacrotask();
    await flushMacrotask();

    assert.equal(findWnd("WndClose"), undefined, "close 后 findWnd 应查不到");
    assert.ok(unboundCount > unboundBefore, "OnWidgetUnboundSEvent 应送达逻辑子 store");
    assert.equal(boundWidget!.isDestroyed, true, "close 后面板节点应销毁");
});

test("加载中 close:不残留有效面板节点", async () => {
    registerCocosUITemplate("WndCancel", { wnd: { wndLayer: 1 } });
    preloadWndPrefab("WndCancel");

    openWnd("WndCancel");
    closeWnd("WndCancel"); // 未 flush:prefab 加载尚未完成即关闭
    await flushMacrotask();
    await flushMacrotask();

    let live: cc.Node[] = [];
    cc.director.getScene()!.walk((n) => {
        if (n.name === "Wnd_WndCancel" && !n.isDestroyed) live.push(n);
    });
    assert.equal(live.length, 0, "加载中关闭不应残留有效面板节点(弱断言,兼容 startAsync/microtask 交错)");
    assert.equal(findWnd("WndCancel"), undefined);
});

test("close 后底层资产仍在(假性卸载边界:逐出须显式 releaseAsset)", () => {
    const cached = cc.resources.get("ui/WndClose", cc.Prefab);
    assert.ok(cached, "prefab 资产仍在 bundle 缓存——现状:窗口关闭不释放底层资产");
    assert.equal(cc.assetManager.assets.has("ui/WndClose"), true, "assetManager 全局缓存仍在");
});
