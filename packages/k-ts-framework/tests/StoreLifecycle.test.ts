import assert from "node:assert/strict";
import { test } from "node:test";

import { D, F } from "../src/index.js";

@D.store()
class LifeRoot extends F.SingletonStore {}

@D.store()
class LifeStore extends F.Store {}

@D.store()
class OtherStore extends F.Store {}

const lifeCreated: number[] = [];
const lifeDestroyed: number[] = [];
let otherCreated = 0;

@D.system("LifeOwnerTag", LifeRoot)
class LifeOwnerSystem extends F.System {
    public init(): void {
        this.subscribe(LifeStore, F.StoreCreateSEvent, (event: F.StoreCreateSEvent) => {
            lifeCreated.push(event.getStore().id);
        });
        this.subscribe(LifeStore, F.StoreDestroySEvent, (event: F.StoreDestroySEvent) => {
            lifeDestroyed.push(event.getStore().id);
        });
        this.subscribe(OtherStore, F.StoreCreateSEvent, () => {
            otherCreated++;
        });
    }
}

test("Store 创建/销毁触发对应类型的生命周期事件", () => {
    F.System.createByTag("LifeOwnerTag");
    let root = LifeRoot.getSingleton();
    assert.ok(root);

    let store = LifeStore.create(root);
    assert.deepEqual(lifeCreated, [store.id], "创建应触发 StoreCreateSEvent 并携带 store 实例");

    let other = OtherStore.create(root);
    assert.equal(lifeCreated.length, 1, "其他类型的 store 创建不应误触发");
    assert.equal(otherCreated, 1, "OtherStore 自己的订阅应正常收到");

    F.Store.destroy(store);
    assert.deepEqual(lifeDestroyed, [store.id], "销毁应触发 StoreDestroySEvent");

    assert.equal(F.Store.findById(store.id), undefined, "销毁后按 id 查不到");
    assert.equal(store.valid, false);
    assert.equal(other.valid, true);
});

test("销毁父 store 级联销毁子树:父事件先于子,子按创建逆序", () => {
    let root = LifeRoot.getSingleton();
    assert.ok(root);

    let parent = LifeStore.create(root);
    let c1 = LifeStore.create(parent);
    let c2 = LifeStore.create(parent);

    lifeDestroyed.length = 0;
    F.Store.destroy(parent);

    assert.deepEqual(lifeDestroyed, [parent.id, c2.id, c1.id]);
    assert.equal(F.Store.findById(c1.id), undefined);
    assert.equal(F.Store.findById(c2.id), undefined);
    assert.equal(parent.valid, false);
    assert.equal(root.valid, true, "根单例不受子树销毁影响");
});

test("单例 store 不允许手动销毁", () => {
    let root = LifeRoot.getSingleton();
    assert.ok(root);
    assert.throws(() => F.Store.destroy(root));
});
