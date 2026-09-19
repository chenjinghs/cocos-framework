import assert from "node:assert/strict";
import { test } from "node:test";

import { cc } from "../src/cc.js";
import { findNode } from "../src/NodeUtil.js";
import { PrefabProxy } from "../src/PrefabProxy.js";

function buildTree() {
    let root = new cc.Node("root");
    let panel = new cc.Node("panel");
    let btn = new cc.Node("btn_ok");
    let title = new cc.Node("title");
    root.addChild(panel);
    panel.addChild(btn);
    btn.addChild(title);
    return { root, panel, btn, title };
}

test("PrefabProxy.getChild 递归查找整棵子树", () => {
    let { root, panel, btn, title } = buildTree();
    let proxy = new PrefabProxy(root);

    let deep = proxy.getChild("title");
    assert.ok(deep);
    assert.equal(deep.getNode(), title, "跨层级查找到最深层节点");

    let mid = proxy.getChild("btn_ok");
    assert.ok(mid);
    assert.equal(mid.getNode(), btn);

    let direct = proxy.getChild("panel");
    assert.ok(direct);
    assert.equal(direct.getNode(), panel);

    assert.equal(proxy.getChild("not_exist"), null);
});

test("PrefabProxy.setActive 透传节点显隐", () => {
    let { root, panel } = buildTree();
    let proxy = new PrefabProxy(root);
    let child = proxy.getChild("panel");

    assert.ok(child);
    assert.equal(panel.active, true);
    child.setActive(false);
    assert.equal(panel.active, false);
    child.setActive(true);
    assert.equal(panel.active, true);
});

test("PrefabProxy.getComponent 取根节点组件", () => {
    let { root } = buildTree();
    let label = root.addComponent(cc.Label);
    let proxy = new PrefabProxy(root);

    assert.equal(proxy.getComponent(cc.Label), label);
    assert.equal(proxy.getComponent(cc.Sprite), null);
});

test("PrefabProxy.on/off 事件订阅与取消", () => {
    let { root } = buildTree();
    let proxy = new PrefabProxy(root);

    let hits = 0;
    let callback = () => hits++;
    proxy.on("click", callback);

    root.emit("click");
    assert.equal(hits, 1);

    proxy.off("click", callback);
    root.emit("click");
    assert.equal(hits, 1, "off 后不再触发");
});

test("findNode：空路径返回 root，路径查找走 getChildByPath，无效 root 返回 null", () => {
    let { root, title } = buildTree();

    assert.equal(findNode(root, ""), root);
    assert.equal(findNode(root, "panel/btn_ok/title"), title);
    assert.equal(findNode(root, "panel/not_exist"), null);

    root.destroy();
    assert.equal(findNode(root, ""), null, "已销毁节点视为无效");
});
