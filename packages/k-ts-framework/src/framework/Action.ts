import { assert } from "../global/GlobalFunctions.js";
import { HookProcessor, HookType, HookUtil } from "../misc/HookDefine.js";
import { Constructor } from "./Interface.js";
import { Store } from "./Store.js";

export type InferActionReturnType<T> = T extends {
    doImp: (check: boolean) => infer P;
}
    ? P
    : void;

export type InferStoreActionReturnType<T> = T extends {
    doImp: (store: Readonly<Store> | Store, check: boolean) => infer P;
}
    ? P
    : void;

const SYMBOL_KEY_STORE = Symbol("KeyStore");
let processor = new HookProcessor();

export class ActionInnerUtil {
    public static hasSubscribed: (ctor: Constructor) => boolean;
    public static dispatch: (action: Action<unknown>) => any;
}

export class Action<TReturnType = void> {
    public static get selfType() {
        return Action;
    }

    public static do<T extends Constructor>(this: T, ...args: ConstructorParameters<T>): InferActionReturnType<InstanceType<T>> {
        let action = new this(...args) as Action<InferActionReturnType<InstanceType<T>>>;
        return action.doImp(true) as InferActionReturnType<InstanceType<T>>;
    }

    public static doWithoutCheck<T extends Constructor>(this: T, ...args: ConstructorParameters<T>): InferActionReturnType<InstanceType<T>> | undefined {
        let action = new this(...args) as Action<InferActionReturnType<InstanceType<T>>>;
        return action.doImp(false) as InferActionReturnType<InstanceType<T>> | undefined;
    }

    public static assertSubscribed<T extends Constructor>(this: T) {
        assert(Action.hasSubscriber.call(this), `do action ${this.name} failed, please subscribe it first`);
    }

    public static hasSubscriber<T extends Constructor>(this: T): boolean {
        return ActionInnerUtil.hasSubscribed(this);
    }

    public doImp(needCheck: boolean = true): TReturnType {
        // 有必要单独弄个成员变量吗？
        processor.reset();
        // RuntimeContext.get().pushInfo(this);
        HookUtil.triggerHook(HookType.onActionPreDo, this, processor);

        let ret;
        if (processor.processed) {
            ret = processor.result;
        } else {
            if (needCheck) {
                Action.assertSubscribed.call(this.constructor as Constructor);
            }

            ret = ActionInnerUtil.dispatch(this);
        }

        HookUtil.triggerHook(HookType.onActionPostDo, this, ret);
        // RuntimeContext.get().popInfo();
        return ret;
    }
}

// ///////////////////////////////////////////////////////////////////////////
export class StoreActionInnerUtil {
    public static findKey: (storeCtor: Constructor, actionCtor: Constructor) => number | undefined;
    public static do: (key: number, action: StoreAction<unknown>) => any;
}

export class StoreAction<TReturnType = void> {
    public static get selfType() {
        return StoreAction;
    }

    public static do<T extends Constructor, StoreType extends typeof Store>(
        this: T,
        store: Readonly<InstanceType<StoreType>>,
        ...args: ConstructorParameters<T>
    ): InferStoreActionReturnType<InstanceType<T>> | undefined {
        let action = new this(...args) as StoreAction<InferStoreActionReturnType<InstanceType<T>>>;
        return action.doImp(store, false);
    }

    public static doWithCheck<T extends Constructor, StoreType extends typeof Store>(
        this: T,
        store: Readonly<InstanceType<StoreType>>,
        ...args: ConstructorParameters<T>
    ): InferStoreActionReturnType<InstanceType<T>> {
        let action = new this(...args) as StoreAction<InferStoreActionReturnType<InstanceType<T>>>;
        return action.doImp(store, true);
    }

    public static hasSubscriber<T extends Constructor, StoreType extends typeof Store>(this: T, store: Readonly<InstanceType<StoreType>>): boolean {
        let key = StoreActionInnerUtil.findKey((store as any).constructor, this);
        return key !== undefined;
    }

    // 使用Symbol作为内部私有变量的Key，以免污染Action中变量命名
    private [SYMBOL_KEY_STORE]?: Readonly<Store>;

    public doImp<StoreType extends Store>(store: Readonly<StoreType> | StoreType, needCheck: boolean = true): TReturnType {
        this[SYMBOL_KEY_STORE] = store;
        processor.reset();

        // RuntimeContext.get().pushInfo(this);
        HookUtil.triggerHook(HookType.onStoreActionPreDo, this, store, processor);

        let ret;
        if (processor.processed) {
            ret = processor.result;
        } else {
            ret = this.doInner(store, needCheck);
        }

        HookUtil.triggerHook(HookType.onStoreActionPostDo, this, store, ret);
        // RuntimeContext.get().popInfo();
        this[SYMBOL_KEY_STORE] = undefined;
        return ret as TReturnType;
    }

    public getStore<T extends Store>(): Readonly<T> {
        return this[SYMBOL_KEY_STORE] as Readonly<T>;
    }

    private doInner<StoreType extends Store>(store: Readonly<StoreType> | StoreType, needCheck: boolean = true): TReturnType {
        if (!store) {
            if (needCheck) assert(false, `do store action ${this.constructor.name} failed, input store is invalid`);
            return undefined as unknown as TReturnType;
        }

        let key = StoreActionInnerUtil.findKey((store as any).constructor, this.constructor as Constructor);
        if (!key) {
            if (needCheck) assert(false, `do store action ${this.constructor.name} failed, input store type is invalid`);
            return undefined as unknown as TReturnType;
        }

        return StoreActionInnerUtil.do(key, this);
    }
}
