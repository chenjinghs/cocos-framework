import { HookProcessor, HookType, HookUtil } from "../misc/HookDefine.js";
import { Constructor } from "./Interface.js";
import { Store } from "./Store.js";

const SYMBOL_KEY_STORE = Symbol("KeyStore");
let processor = new HookProcessor();

export class EventInnerUtil {
    public static dispatch: (event: Event) => void;
}

export class Event {
    public static get selfType() {
        return Event;
    }

    public static dispatch<T extends Constructor>(this: T, ...args: ConstructorParameters<T>) {
        let event = new this(...args) as Event;
        event.dispatchImp();
    }

    public dispatchImp() {
        processor.reset();

        // RuntimeContext.get().pushInfo(this);
        HookUtil.triggerHook(HookType.onEventPreDispatch, this, processor);

        if (!processor.processed) {
            // Env.getCurrentData(EventSubscriber).dispatch(this.constructor, this);
            EventInnerUtil.dispatch(this);
        }

        HookUtil.triggerHook(HookType.onEventPostDispatch, this);
        // RuntimeContext.get().popInfo();
    }
}

// ///////////////////////////////////////////////////////////////////////////
export class StoreEventInnerUtil {
    public static findKey: (storeCtor: Constructor, eventCtor: Constructor) => number | undefined;
    public static dispatch: (key: number, event: StoreEvent) => any;
}

export class StoreEvent {
    public static get selfType() {
        return StoreEvent;
    }

    public static hasSubscriber<EventType extends Constructor, StoreType extends typeof Store>(this: EventType, store: Readonly<InstanceType<StoreType>>): boolean {
        return StoreEventInnerUtil.findKey((store as any).constructor, this) !== undefined;
    }

    public static dispatch<EventType extends Constructor, StoreType extends typeof Store>(this: EventType, store: Readonly<InstanceType<StoreType>>, ...args: ConstructorParameters<EventType>): void {
        if (!store) {
            return;
        }

        let key = StoreEventInnerUtil.findKey((store as any).constructor, this);
        if (!key) {
            return;
        }

        let event = new this(...args) as StoreEvent;
        event.dispatchInner(store, key);
    }

    // 使用Symbol作为内部私有变量的Key，以免污染Event中变量命名
    private [SYMBOL_KEY_STORE]?: Readonly<Store>;

    public dispatchImp<StoreType extends Constructor>(store: Readonly<InstanceType<StoreType>>): any {
        let key = StoreEventInnerUtil.findKey((store as any).constructor, this.constructor as Constructor);
        if (!key) {
            return;
        }
        this.dispatchInner(store, key);
    }

    public getStore<T extends Store>(): Readonly<T> {
        return this[SYMBOL_KEY_STORE] as Readonly<T>;
    }

    private dispatchInner(store: any, key: any) {
        this[SYMBOL_KEY_STORE] = store;
        processor.reset();

        // RuntimeContext.get().pushInfo(this);
        HookUtil.triggerHook(HookType.onStoreEventPreDispatch, this, store, processor);

        if (!processor.processed) {
            StoreEventInnerUtil.dispatch(key, this);
        }

        HookUtil.triggerHook(HookType.onStoreEventPostDispatch, this, store);
        // RuntimeContext.get().popInfo();
        this[SYMBOL_KEY_STORE] = undefined;
    }
}
