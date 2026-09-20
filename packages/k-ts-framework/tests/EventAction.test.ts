import assert from "node:assert/strict";
import { test } from "node:test";

import { D, F } from "../src/index.js";

// 核心事件：构造参数透传给订阅者
class LoadEvent extends F.Event {
    public constructor(public payload: string) {
        super();
    }
}

// 全局动作：do 返回订阅方计算结果
class AddAction extends F.Action<number> {
    public constructor(public value: number) {
        super();
    }
}

// 从未订阅过的动作：验证 do 的断言与 doWithoutCheck 的静默路径
class UnsubAction extends F.Action<void> {}

// 定向到具体 Store 的事件/动作
@D.store()
class EAStore extends F.Store {}

@D.store()
class EAOtherStore extends F.Store {}

@D.store()
class EARootStore extends F.SingletonStore {}

class StoreProbeEvent extends F.StoreEvent {}

class StoreProbeAction extends F.StoreAction<string> {
    public constructor(public suffix: string) {
        super();
    }
}

let lastEvent = "";
let dispatchCount = 0;
const createdSystems: EvtSystem[] = [];
const loadCallback = (event: LoadEvent) => {
    lastEvent = event.payload;
    dispatchCount++;
};

@D.system("EvtActionTag")
class EvtSystem extends F.System {
    public init(): void {
        createdSystems.push(this);
        this.subscribe(LoadEvent, loadCallback);
        this.subscribe(AddAction, (action: AddAction) => action.value + 1);
        this.subscribe(EAStore, StoreProbeEvent, () => {
            dispatchCount++;
        });
        this.subscribe(EAStore, StoreProbeAction, (action: StoreProbeAction) => "ea" + action.suffix);
    }
}

@D.system("EvtActionRootTag", EARootStore)
class EARootSystem extends F.System {}

@D.system("EvtActionTag2")
class EvtSecondSystem extends F.System {
    public init(): void {
        this.subscribe(LoadEvent, () => {
            dispatchCount++;
        });
    }
}

test("Event 分发:订阅者收到事件实例与构造参数", () => {
    F.System.createByTag("EvtActionTag");
    F.System.createByTag("EvtActionTag2");
    LoadEvent.dispatch("boot");
    assert.equal(lastEvent, "boot");
});

test("Event 多播:同事件的两个订阅者都被调用", () => {
    let before = dispatchCount;
    LoadEvent.dispatch("again");
    assert.equal(dispatchCount, before + 2);
});

test("Action.do 返回订阅方结果", () => {
    assert.equal(AddAction.do(41), 42);
});

test("Action 无订阅者:do 断言失败,doWithoutCheck 静默返回 undefined", () => {
    assert.equal(UnsubAction.hasSubscriber(), false);
    assert.throws(() => UnsubAction.do());
    assert.equal(UnsubAction.doWithoutCheck(), undefined);
});

test("StoreEvent 按 Store 类型定向分发", () => {
    F.System.createByTag("EvtActionRootTag");
    let root = EARootStore.getSingleton();
    assert.ok(root, "system 创建后单例 store 应自动创建");

    let store = EAStore.create(root);
    let other = EAOtherStore.create(root);

    let before = dispatchCount;
    StoreProbeEvent.dispatch(store);
    assert.equal(dispatchCount, before + 1, "已订阅的 Store 类型应收到事件");

    before = dispatchCount;
    StoreProbeEvent.dispatch(other);
    assert.equal(dispatchCount, before, "未订阅的 Store 类型不应收到事件");
});

test("StoreAction.do 定向到已订阅的 Store 并返回结果", () => {
    let root = EARootStore.getSingleton();
    let store = EAStore.create(root);
    assert.equal(StoreProbeAction.hasSubscriber(store), true);

    let other = EAOtherStore.create(root);
    assert.equal(StoreProbeAction.hasSubscriber(other), false);

    assert.equal(StoreProbeAction.do(store, "-ok"), "ea-ok");
    assert.equal(StoreProbeAction.do(other, "-x"), undefined, "无订阅的 Store 静默返回 undefined");
    assert.throws(() => StoreProbeAction.doWithCheck(other, "-x"));
});

test("unsubscribe 后不再分发", () => {
    assert.ok(createdSystems.length > 0);
    assert.equal(createdSystems[0].unsubscribe(LoadEvent, loadCallback), true);

    let before = dispatchCount;
    let last = lastEvent;
    LoadEvent.dispatch("dropped");
    assert.equal(dispatchCount, before + 1, "第二个订阅者仍在,被取消的那个不再收到");
    assert.equal(lastEvent, last, "被取消的订阅者不应更新 lastEvent");
});

test("System 销毁后其全部订阅自动清理", () => {
    F.System.destroyByTag(["EvtActionTag", "EvtActionTag2"]);
    let before = dispatchCount;
    LoadEvent.dispatch("after-destroy");
    assert.equal(dispatchCount, before, "销毁的系统不应再收到事件");
    assert.throws(() => AddAction.do(1), "订阅者随系统销毁,do 应断言失败");
});
