import assert from "node:assert/strict";
import { test } from "node:test";

import { D, F } from "k-ts-framework";
import { cc } from "k-ts-framework-cocos";
import { findWnd, OnWidgetBoundSEvent, openWnd, RUIStore } from "k-ui-framework";

import { bindChildren, findPrefabProxy, getPrefabProxy, registerCocosUI, registerCocosUITemplate } from "../src/index.js";

function setupSceneWithCanvas() {
    let scene = new cc.Scene("TestScene");
    cc.director.currentScene = scene;

    let canvas = new cc.Node("Canvas");
    canvas.addComponent(cc.Canvas);
    scene.addChild(canvas);
}

async function flushMacrotask() {
    // mock 加载链全部为 microtask，跑完一个 macrotask 回合即可确定性地全部排空
    await new Promise<void>((resolve) => {
        setImmediate(resolve);
    });
}

/** 子 prefab 的逻辑 store：模板 storeTags 声明后随 item uiStore 自动创建，用于接收绑定事件 */
@D.store("BindItemLogicTag")
class ItemLogicStore extends F.Store {}

/** 捕获 item 逻辑 store 收到的 OnWidgetBoundSEvent 参数（bindPrefab 的 params 观测点） */
const capturedParams: unknown[] = [];

@D.system("BindChildrenCaptureSystemTag")
class CaptureSystem extends F.System {
    public init(): boolean {
        this.subscribe(ItemLogicStore, OnWidgetBoundSEvent, (event: OnWidgetBoundSEvent) => {
            capturedParams.push(event.params);
        });
        return true;
    }
}

/** 带 @bindChildren 声明的逻辑 store：面板绑定后 items 被赋值为子 prefab store 数组 */
@D.store()
class HostStore extends F.Store {
    @bindChildren("list", "Item", ["p0", "p1"])
    public items!: RUIStore[];
}

function preloadHostPrefab() {
    let prefab = new cc.Prefab();
    let root = new cc.Node("BindHost");
    let content = new cc.Node("content");
    content.addComponent(cc.Label);
    root.addChild(content);
    let list = new cc.Node("list");
    list.addChild(new cc.Node("c0"));
    list.addChild(new cc.Node("c1"));
    root.addChild(list);
    prefab.data = root;
    cc.resources.setAssetForTest("ui/BindHost", prefab);
}

test("@bindChildren 参数数组与子节点一一对应分发", async () => {
    setupSceneWithCanvas();
    registerCocosUI();
    F.System.createByTag("BindChildrenCaptureSystemTag");
    registerCocosUITemplate("BindHost", { wnd: { wndLayer: 1 } });
    registerCocosUITemplate("Item", { storeTags: ["BindItemLogicTag"] });
    preloadHostPrefab();

    openWnd("BindHost");
    let wnd = findWnd("BindHost");
    assert.ok(wnd, "openWnd 返回后 wnd store 应同步存在");

    // 在面板资源绑定完成（异步加载）前挂上逻辑 store，使 _bindRes 时装饰器生效
    HostStore.create(wnd);
    await flushMacrotask();

    let host = F.findStoreChildByCtor(wnd, HostStore);
    assert.ok(host, "HostStore 应挂在 wnd 下");
    assert.equal(host.items.length, 2, "list 下两个子节点应各绑定一个 store");

    // 修复前：每个子 prefab 都收到整个数组 ["p0","p1"]；修复后：c0 收 "p0"，c1 收 "p1"
    assert.deepEqual(capturedParams, ["p0", "p1"]);
});

test("getPrefabProxy 返回带控件扩展方法的 PrefabProxyEx", () => {
    let wnd = findWnd("BindHost");
    assert.ok(wnd, "依赖上一个测试打开的窗口");

    // 未绑定 prefab 的逻辑 store：findPrefabProxy 返回 undefined
    let host = F.findStoreChildByCtor(wnd, HostStore);
    assert.ok(host);
    assert.equal(findPrefabProxy(host), undefined);

    // wnd 自身已绑定：getPrefabProxy 返回代理且扩展方法可用
    let proxy = getPrefabProxy<{ content: "content" }>(wnd);
    proxy.setText("content", "hello");
    assert.equal(proxy.getText("content"), "hello");
});
