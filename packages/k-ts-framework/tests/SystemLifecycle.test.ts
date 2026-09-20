import assert from "node:assert/strict";
import { test } from "node:test";

import { D, F } from "../src/index.js";

class ProbeEvent extends F.Event {}

const trace: string[] = [];
let probeHit = false;

@D.store()
class OwnedSingleton extends F.SingletonStore {}

@D.system("SysA")
class SysA extends F.System {
    public init(): void {
        trace.push("A:init");
    }
    public postInit(): void {
        trace.push("A:postInit");
    }
    public preUninit(): void {
        trace.push("A:preUninit");
    }
    public uninit(): void {
        trace.push("A:uninit");
    }
}

@D.system("SysB", OwnedSingleton)
class SysB extends F.System {
    public init(): void {
        trace.push("B:init");
        // 订阅随系统销毁自动清理的观测点
        this.subscribe(ProbeEvent, () => {
            probeHit = true;
        });
    }
    public postInit(): void {
        trace.push("B:postInit");
    }
    public preUninit(): void {
        trace.push("B:preUninit");
    }
    public uninit(): void {
        trace.push("B:uninit");
    }
}

test("创建顺序:init 先于 postInit,重复 createByTag 幂等", () => {
    F.System.createByTag("SysA");
    assert.deepEqual(trace, ["A:init", "A:postInit"]);

    F.System.createByTag("SysA");
    assert.deepEqual(trace, ["A:init", "A:postInit"], "重复创建不应再次触发生命周期");
});

test("系统创建时自动创建其单例 store,销毁时一并销毁", () => {
    F.System.createByTag("SysB");
    let singleton = OwnedSingleton.getSingleton();
    assert.ok(singleton, "system 创建后单例 store 应自动创建");
    assert.equal(singleton.valid, true);

    F.System.destroyByTag("SysB");
    assert.equal(singleton.valid, false, "system 销毁后单例 store 应失效");
});

test("destroyByTag:preUninit 先于 uninit,订阅随系统清理", () => {
    // 重建 SysB(上一条已销毁)
    trace.length = 0;
    probeHit = false;
    F.System.createByTag("SysB");
    assert.equal(trace[0], "B:init");

    trace.length = 0;
    F.System.destroyByTag("SysB");
    assert.deepEqual(trace, ["B:preUninit", "B:uninit"]);

    probeHit = false;
    ProbeEvent.dispatch();
    assert.equal(probeHit, false, "系统销毁后其订阅应被清理");
});

test("销毁后可重建:生命周期重新触发,单例为全新实例", () => {
    F.System.createByTag("SysB");
    let oldSingleton = OwnedSingleton.getSingleton();

    F.System.destroyByTag("SysB");
    assert.equal(oldSingleton.valid, false);

    trace.length = 0;
    F.System.createByTag("SysB");
    assert.deepEqual(trace, ["B:init", "B:postInit"]);
    let newSingleton = OwnedSingleton.getSingleton();
    assert.ok(newSingleton);
    assert.notEqual(newSingleton.id, oldSingleton.id, "重建后应为新实例");
});

test("destroyAll 按创建顺序反向销毁:先全部 preUninit 再 uninit", () => {
    // 当前存活:SysA(先创建)与 SysB(后创建)
    trace.length = 0;
    F.System.destroyAll();
    assert.deepEqual(trace, [
        "B:preUninit",
        "A:preUninit",
        "B:uninit",
        "A:uninit",
    ]);
});
