import { D, F } from "k-ts-framework";
import { cc, PrefabProxy, SupportedCocosEvent } from "k-ts-framework-cocos";
import { bindPrefab, unbindPrefab } from "k-ui-framework";

import { COCOS_UI_SYSTEM_TAG } from "./Define.js";
import { _bindRes, _unbindRes } from "./PrivateUtil.js";

interface IPrefabEventInfo {
    objectName: string;
    eventName: string;
    callback: (...args: unknown[]) => void;
}

interface IPrefabBindInfo {
    objectName: string;
    prefabTag: string;
    propertyName: string;
    params?: unknown;
    isChildren: boolean;
}

/**
 * 兼容 legacy(prototype, key[, descriptor]) 与 TC39 stage-3(value, context) 两种装饰器参数形态:
 * 生产链路(tsc/webpack)发 legacy;tsx/esbuild 转换链路对方法/字段装饰器可能发 stage-3。
 * stage-3 拿不到持有类,延迟到首个实例构造时注册(addInitializer 的 this 即实例);
 * 注册语义与 legacy 装饰期注册一致——prefab 绑定必然晚于 store/system 实例化。
 */
function decorateMember(
    target: unknown,
    propertyKeyOrContext: unknown,
    descriptor: PropertyDescriptor | undefined,
    register: (ctor: Function, name: string, method: unknown) => void,
): void {
    let ctx = propertyKeyOrContext as { name?: unknown; addInitializer?: (init: (this: unknown) => void) => void };
    if (propertyKeyOrContext !== null && typeof propertyKeyOrContext === "object" && (typeof ctx.name === "string" || typeof ctx.name === "symbol")) {
        let name = String(ctx.name);
        let method = target;
        let registered = false;
        ctx.addInitializer?.(function (this: unknown) {
            if (registered) return;
            registered = true;
            register((this as { constructor: Function }).constructor, name, method);
        });
    } else {
        let holder = target as { constructor: Function };
        register(holder.constructor, String(propertyKeyOrContext as string | symbol), descriptor?.value);
    }
}

/**
 * Cocos UI 装饰器运行时：把 @onPrefabEvent 声明的事件与 @bind/@bindChildren 声明的 prefab
 * 在 prefab 绑定时应用到 store 上，解绑时清理。语义对齐 Unity 版 DecoratorExtension。
 */
class UICocosDecoratorOperator extends F.HookOperatorBase {
    private systemInstanceMap = new Map<Function, F.System>();
    private subscribeHelperMap = new Map<Function, F.SubscribeHelper>();
    private prefabEventRegistries = new Map<Function, IPrefabEventInfo[]>();
    private prefabBindRegistries = new Map<Function, IPrefabBindInfo[]>();
    private eventHandles = new Map<number /** store.id */, number[]>();

    // //////////////////////////////////////////////////////
    // HookOperatorBase interface
    public inheritFrom(_source: F.HookOperatorBase, _dataInheritType: F.EDataInheritType): void {}

    public getDescription(): string {
        return "CocosUIDecorator";
    }

    public getHookType(): F.HookType | F.HookType[] {
        return [F.HookType.onSystemPostCreate, F.HookType.onSystemPreDestroy];
    }

    public onSystemPostCreate(system: F.System, subscribeHelper: F.SubscribeHelper) {
        this.systemInstanceMap.set(system.constructor, system);
        this.subscribeHelperMap.set(system.constructor, subscribeHelper);
    }

    public onSystemPreDestroy(system: F.System, _subscribeHelper: F.SubscribeHelper) {
        this.systemInstanceMap.delete(system.constructor);
        this.subscribeHelperMap.delete(system.constructor);
    }

    // //////////////////////////////////////////////////////
    // 注册入口（装饰器调用）
    public registerPrefabEvent(systemCtor: Function, objectName: string, eventName: string, callback: (...args: unknown[]) => void) {
        let eventInfoList = this.prefabEventRegistries.get(systemCtor) ?? [];
        eventInfoList.push({ objectName, eventName, callback });
        this.prefabEventRegistries.set(systemCtor, eventInfoList);
    }

    public registerPrefabBind(storeCtor: Function, objectName: string, prefabTag: string, propertyName: string, params?: unknown, isChildren = false) {
        let prefabBindInfoList = this.prefabBindRegistries.get(storeCtor) ?? [];
        prefabBindInfoList.push({ objectName, prefabTag, propertyName, params, isChildren });
        this.prefabBindRegistries.set(storeCtor, prefabBindInfoList);
    }

    // //////////////////////////////////////////////////////
    // 绑定时应用
    public bindRegisteredEvent(store: F.RStore, prefabProxy: PrefabProxy) {
        let systemCtor = F.getStoreOwnerCtor(store);
        // 无属主系统的 store 不可能注册了 prefab 事件（注册表以 system ctor 为键），直接跳过
        if (systemCtor === undefined) return;
        let eventInfoList = this.prefabEventRegistries.get(systemCtor);
        if (eventInfoList === undefined || eventInfoList.length === 0) return;

        let systemInstance = this.systemInstanceMap.get(systemCtor);
        F.assert(systemInstance, "bindRegisteredEvent failed, system instance is null");

        let subscribeHelper = this.subscribeHelperMap.get(systemCtor);
        F.assert(subscribeHelper, "bindRegisteredEvent failed, subscribe helper is null");

        let handles = eventInfoList.map((info) => {
            let child = prefabProxy.getChild(info.objectName);
            F.assert(child, `bindRegisteredEvent failed, cannot find [${info.objectName}]`);
            let finalCallback = (...args: unknown[]) => info.callback.call(systemInstance, store, ...args);
            // 3.8 的 cc.Node 类型不继承 EventTarget(运行时的 on/off 签名一致),结构等价转换
            return subscribeHelper.subscribe(new SupportedCocosEvent(child.getNode() as unknown as cc.EventTarget, info.eventName), finalCallback);
        });

        this.eventHandles.set(store.id, handles);
    }

    public unbindRegisteredEvent(store: F.RStore) {
        let systemCtor = F.getStoreOwnerCtor(store);
        if (systemCtor === undefined) return;
        let subscribeHelper = this.subscribeHelperMap.get(systemCtor);
        let handles = this.eventHandles.get(store.id);
        handles?.forEach((handle) => subscribeHelper?.unsubscribeWithHandle(handle));
        this.eventHandles.delete(store.id);
    }

    public bindRegisteredPrefab(store: F.RStore, prefabProxy: PrefabProxy) {
        let storeCtor = store.constructor;
        let prefabBindInfoList = this.prefabBindRegistries.get(storeCtor);
        if (prefabBindInfoList === undefined) return;

        for (let { objectName, propertyName, prefabTag, params, isChildren } of prefabBindInfoList) {
            let child = prefabProxy.getChild(objectName);
            F.assert(child, `bindRegisteredPrefab failed, cannot find [${objectName}]`);
            let prefabStore = isChildren
                ? child.getNode().children.map((node, index) => bindPrefab(store, node, prefabTag, params === undefined ? undefined : Array.isArray(params) ? params[index] : params))
                : bindPrefab(store, child.getNode(), prefabTag, params);
            Object.defineProperty(store, propertyName, { value: prefabStore, configurable: true, writable: true });
        }
    }

    public unbindRegisteredPrefab(store: F.RStore) {
        let storeCtor = store.constructor;
        let prefabBindInfoList = this.prefabBindRegistries.get(storeCtor);
        if (prefabBindInfoList === undefined) return;

        for (let { propertyName } of prefabBindInfoList) {
            let prefabStore = Object.getOwnPropertyDescriptor(store, propertyName)?.value;
            if (prefabStore === undefined) continue;
            Array.isArray(prefabStore) ? prefabStore.forEach((v) => unbindPrefab(v)) : unbindPrefab(prefabStore);
            Object.defineProperty(store, propertyName, { value: undefined, configurable: true, writable: true });
        }
    }
}

@D.system(COCOS_UI_SYSTEM_TAG)
class UICocosDecoratorSystem extends F.System {
    @D.linkUtil(_bindRes)
    protected bindRes(store: F.RStore, prefabProxy: PrefabProxy) {
        let operator = F.HookUtil.get(UICocosDecoratorOperator, true);
        operator.bindRegisteredPrefab(store, prefabProxy);
        operator.bindRegisteredEvent(store, prefabProxy);
    }

    @D.linkUtil(_unbindRes)
    protected unbindRes(store: F.RStore) {
        let operator = F.HookUtil.get(UICocosDecoratorOperator, true);
        operator.unbindRegisteredEvent(store);
        operator.unbindRegisteredPrefab(store);
    }
}

/**
 * 订阅一个 prefab 节点事件的装饰器（挂在 System 方法上）：
 * 面板绑定后自动把 cc 事件桥接到该方法，签名 (store, ...eventArgs)。
 */
export function onPrefabEvent(objectName: string, eventName: string): MethodDecorator {
    return (target, propertyKey, descriptor) => {
        decorateMember(target, propertyKey, descriptor, (ctor, _name, method) => {
            // reason: 装饰器边界的方法值标准库即 any,收窄为事件回调签名
            let callback = method as (...args: unknown[]) => void | undefined;
            F.HookUtil.get(UICocosDecoratorOperator, true)?.registerPrefabEvent(ctor, objectName, eventName, callback);
        });
    };
}

/**
 * 在 Store 上声明一个 prefab 绑定：属性在面板绑定后被赋值为 RUIStore。
 * @param objectName 面板内节点名
 * @param prefabTag 子 prefab 的 UI tag
 * @param params 传递给子 prefab 的参数，可选
 */
export function bind(objectName: string, prefabTag: string, params?: unknown): PropertyDecorator {
    return (target, propertyKey) => {
        decorateMember(target, propertyKey, undefined, (ctor, name) => {
            F.HookUtil.get(UICocosDecoratorOperator, true)?.registerPrefabBind(ctor, objectName, prefabTag, name, params);
        });
    };
}

/**
 * 在 Store 上声明一组子 prefab 绑定：属性在面板绑定后被赋值为 RUIStore[]。
 * @param objectName 面板内节点名
 * @param prefabTag 子 prefab 的 UI tag
 * @param params 参数或参数数组（与子节点一一对应），可选
 */
export function bindChildren(objectName: string, prefabTag: string, params?: unknown | unknown[]): PropertyDecorator {
    return (target, propertyKey) => {
        decorateMember(target, propertyKey, undefined, (ctor, name) => {
            F.HookUtil.get(UICocosDecoratorOperator, true)?.registerPrefabBind(ctor, objectName, prefabTag, name, params, true);
        });
    };
}
