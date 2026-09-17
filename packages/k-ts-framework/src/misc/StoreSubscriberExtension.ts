import { getManager } from "../framework/Interface";
import { RStore, Store } from "../framework/Store";
import { System } from "../framework/System";
import { assert } from "../global/GlobalFunctions";
import { HookType, HookUtil } from "./HookDefine";
import { HookOperatorBase } from "./HookUtilImpl";
import { SubscribeHook } from "./SubscribeHook";
import { checkArgsEqual, ISubscriber, SubscribeInstanceInfo } from "./Subscriber";

declare module "../framework/System" {
    export interface System {
        subscribeWithStoreLifecycle(store: Store | RStore, ...args: any[]): number;
        unsubscribeWithStoreLifecycle(store: Store | RStore, ...args: any[]): boolean;
    }
}

System.prototype.subscribeWithStoreLifecycle = function (store: Store | RStore, ...args: any[]): number {
    return getManager()
        .getSystemSubscribeHelper(this)
        .subscribe(STORE_LIFECYCLE_SUBSCRIBER_TYPE, this, store, ...args);
};

System.prototype.unsubscribeWithStoreLifecycle = function (store: Store | RStore, ...args: any[]): boolean {
    return getManager()
        .getSystemSubscribeHelper(this)
        .unsubscribe(STORE_LIFECYCLE_SUBSCRIBER_TYPE, this, store, ...args);
};

// /////////////////////////////////////////////////////////////////////////////////////////////////////
const STORE_LIFECYCLE_SUBSCRIBER_TYPE = Symbol("StoreLifecycleSubscriber");
type StoreLifeCycleSubscriberType = typeof STORE_LIFECYCLE_SUBSCRIBER_TYPE;

const NORMAL_FUNCTION_PROTOTYPE = Object.getPrototypeOf(() => {});
function isNormalFunction(func: unknown): func is Function {
    return typeof func === "function" && Object.getPrototypeOf(func) === NORMAL_FUNCTION_PROTOTYPE;
}

class StoreLifecycleSubscriber implements ISubscriber {
    private storeInfos = new Map<number, Array<[System, symbol]>>();

    public canProcess<T extends StoreLifeCycleSubscriberType>(type: T): boolean {
        return type === STORE_LIFECYCLE_SUBSCRIBER_TYPE;
    }

    public equal(sourceArgs: any[], targetArgs: any[]): boolean {
        return checkArgsEqual(sourceArgs, targetArgs, sourceArgs.length);
    }

    public subscribe(info: SubscribeInstanceInfo, _s: symbol, system: System, store: Store | RStore, ...args: any[]) {
        assert(info.resolve || store, `store subscribe failed, input store is invalid`);
        assert(store.valid, `store subscribe failed, input store is invalid, store ctor: ${store.constructor.name}`);

        let handle = Symbol("StoreLifecycleSubscriberHandle");
        let storeId = store.id;
        let infos = this.verifyInfos(storeId, true)!;

        for (let i = 0; i < args.length; ++i) {
            let arg = args[i];
            if (!isNormalFunction(arg)) continue;

            // 将callback改成带store的
            args[i] = (...args: any[]) => {
                if (store.valid) arg.call(system, store, ...args);
            };
        }

        system.subscribeWithHandle(handle, ...args);
        infos.push([system, handle]);
        return handle;
    }

    public unsubscribe(info: SubscribeInstanceInfo, _: symbol, system: System, store: Store | RStore): boolean {
        let handle = info.subscribeResult as symbol;

        let infos = this.verifyInfos(store.id, false);
        if (!infos) return false;

        let index = infos.findIndex(([sys, h]) => {
            if (sys === system && h === handle) {
                sys.unsubscribeWithHandle(h);
                return true;
            }
            return false;
        });
        if (index >= 0) {
            infos.splice(index, 1);
            if (infos.length === 0) this.storeInfos.delete(store.id);
            return true;
        } else {
            return false;
        }
    }

    public getInfo(info: SubscribeInstanceInfo | undefined, _: symbol, system: System, store: Store | RStore, ...args: any[]): string {
        return `store lifecycle subscriber, system ${system.constructor.name}, store: ${store.constructor.name}`;
    }

    public unsubscribeAllWithStore(store: Store) {
        let storeId = store.id;
        let infos = this.storeInfos.get(storeId);
        if (infos) {
            for (let [sys, h] of infos) {
                sys.unsubscribeWithHandle(h);
            }
            this.storeInfos.delete(storeId);
        }
    }

    // public clearWithSystem(system: System) {
    //     this.storeInfos.forEach((infos) => {
    //         let toBeRemoved: Array<number> | undefined;
    //         for (let i = 0; i < infos.length; ++i) {
    //             if (infos[i][0] === system) {
    //                 toBeRemoved = toBeRemoved ?? [];
    //                 toBeRemoved.push(i);
    //             }
    //         }
    //         if (toBeRemoved) {
    //             for (let i = toBeRemoved.length - 1; i >= 0; --i) {
    //                 infos.splice(toBeRemoved[i], 1);
    //             }
    //         }
    //     });
    // }

    private verifyInfos(storeId: number, createIfNotExist: boolean = false) {
        let infos = this.storeInfos.get(storeId);
        if (!infos && createIfNotExist) {
            infos = new Array<[System, symbol]>();
            this.storeInfos.set(storeId, infos);
        }
        return infos;
    }
}
HookUtil.get(SubscribeHook).registerSubscriber(StoreLifecycleSubscriber);

// ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
class StoreLifecycleSubscriberHook extends HookOperatorBase {
    private subscriber: StoreLifecycleSubscriber;

    public constructor() {
        super();
        this.subscriber = HookUtil.get(SubscribeHook).getSubscriber(StoreLifecycleSubscriber);
    }

    public getDescription(): string {
        return "store lifecycle subscriber hook";
    }

    public getHookType(): HookType | HookType[] {
        return HookType.onStorePreDestroy;
    }

    public inheritFrom(source: StoreLifecycleSubscriberHook) {}

    public onStorePreDestroy(store: Store): void {
        this.subscriber.unsubscribeAllWithStore(store);
    }

    // public onSystemPostDestroy(system: System): void {
    //     this.subscriber.clearWithSystem(system);
    // }
}
HookUtil.create(StoreLifecycleSubscriberHook);
