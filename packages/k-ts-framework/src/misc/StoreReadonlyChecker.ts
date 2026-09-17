import { Action, StoreAction } from "../framework/Action";
import { Event, StoreEvent } from "../framework/Event";
import { Constructor, EDataInheritType } from "../framework/Interface";
import { Store, StoreProxy } from "../framework/Store";
import { assert, stacktrace } from "../global";
import { HookType } from "./HookDefine";
import { HookOperatorBase, HookUtil } from "./HookUtilImpl";

let stackInfos: Array<Store | undefined> | undefined;
let needsThrowError: boolean = true;
let ignoreData = new Map<Constructor<Store>, (string | symbol | number)[]>();

let proxyHandle = {
    get: get,
    set: set,
};

function getSource(obj: any) {
    return obj?.hasOwnProperty("__readonlyProxySource") && obj.__readonlyProxySource;
}

function createProxy(obj: any, store: Store) {
    Object.defineProperty(obj, "__readonlyProxySource", { value: store, enumerable: false });
    return new Proxy(obj, proxyHandle);
}

function get(obj: any, property: string) {
    let ret = obj[property];
    if (
        !ret ||
        property === "constructor" || // 访问构造函数
        property === "__readonlyProxySource" || // 访问source
        obj.constructor.hasOwnProperty("StaticClass") ||
        !ret.constructor ||
        ret.constructor.hasOwnProperty("StaticClass")
    ) {
        // 访问虚幻的object
        return ret;
    } else if (stackInfos && typeof ret === "object") {
        // prettier-ignore
        let isIgnore = ignoreData.get(obj.constructor)?.includes(property);
        if (isIgnore !== true && !getSource(ret)) {
            let source = getSource(obj);
            assert(source);
            ret = createProxy(ret, source);
            obj[property] = ret;
        }
    } else if (typeof ret === "function") {
        ret = ret.bind(obj);
    }

    return ret;
}

function set(obj: any, property: string, value: any) {
    let source = getSource(obj);
    if (
        stackInfos &&
        property !== "__readonlyProxySource" &&
        (stackInfos!.length === 0 || getSource(stackInfos![stackInfos!.length - 1]) !== source)
    ) {
        if (!(source === obj && property === "children")) {
            // 把children修改滤掉
            if (source === obj) {
                outputError(`can not modify property ${property} of ${
                        obj.constructor.name
                } which is readonly, stacktrace:\n${stacktrace()}}`)
            } else {
                outputError( `can not modify property ${property} of ${obj.constructor.name} in ${
                        source.constructor.name
                } which is readonly, stacktrace:\n${stacktrace()}`)
            }
        }
    }
    obj[property] = value;
    return true;
}

function outputError(message: string) {
    if (needsThrowError) {
        throw new Error(message);
    } else {
        console.error(message);
    }
}

// 调用action event时都push个空的，防止action event接收后直接改
function pushStack(store?: Store) {
    stackInfos!.push(store);
}

function popStack(store?: Store) {
    let ret = stackInfos!.pop();
    assert(ret === store);
}

// ////////////////////////////////////////////////////////////////////
class StoreReadonlyChecker extends HookOperatorBase {
    public getDescription(): string {
        return "store readonly checker";
    }

    public getHookType(): HookType | HookType[] {
        return [
            HookType.onStorePostCreate,
            HookType.onStorePreModify,
            HookType.onStorePostModify,
            HookType.onActionPreDo,
            HookType.onActionPostDo,
            HookType.onEventPreDispatch,
            HookType.onEventPostDispatch,
            HookType.onStoreActionPreDo,
            HookType.onStoreActionPostDo,
            HookType.onStoreEventPreDispatch,
            HookType.onStoreEventPostDispatch,
        ];
    }

    public inheritFrom(_source: StoreReadonlyChecker, _dataInheritType: EDataInheritType) {}

    public onStorePostCreate(store: Store, proxy: StoreProxy) {
        proxy.value = createProxy(proxy.value || store, store);
    }

    public onStorePreModify(store: Store) {
        pushStack(store);
    }

    public onStorePostModify(store: Store, _changed: boolean) {
        popStack(store);
    }

    public onActionPreDo(_action: Action) {
        pushStack();
    }

    public onActionPostDo(_action: Action) {
        popStack();
    }

    public onEventPreDispatch(_event: Event) {
        pushStack();
    }

    public onEventPostDispatch(_event: Event) {
        popStack();
    }

    public onStoreActionPreDo(_action: StoreAction) {
        pushStack();
    }

    public onStoreActionPostDo(_action: StoreAction) {
        popStack();
    }

    public onStoreEventPreDispatch(_event: StoreEvent) {
        pushStack();
    }

    public onStoreEventPostDispatch(_event: StoreEvent) {
        popStack();
    }
}

export function setEnabled(enable: boolean, inNeedsThrowError = true) {
    needsThrowError = inNeedsThrowError;
    if (enable) {
        stackInfos = new Array<Store | undefined>();
        HookUtil.create(StoreReadonlyChecker);
    } else {
        HookUtil.destroy(StoreReadonlyChecker);
        stackInfos = undefined;
    }
}

export function ignore<T extends Constructor<Store>>(store: T, keys: keyof InstanceType<T> | (keyof InstanceType<T>)[]) {
    let ignoreKeys = ignoreData.get(store) ?? [];
    Array.isArray(keys) ? ignoreKeys.push(...keys) : ignoreKeys.push(keys);
    ignoreData.set(store, ignoreKeys);
}