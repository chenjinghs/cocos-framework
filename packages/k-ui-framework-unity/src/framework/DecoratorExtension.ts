import { D, F } from "k-ts-framework";
import { PrefabProxy, SupportedUnityEvent } from "k-ts-framework-unity";
import { unbindPrefab } from "k-ui-framework";

import { UNITY_UI_SYSTEM_TAG } from "./Define";
import { _bindRes, _unbindRes } from "./PrivateUtil";

interface UIEventInfo {
    objectName: string;
    componentName: string;
    eventName: string;
    callback: (...args: any[]) => void;
}

interface UIPrefabBindInfo {
    objectName: string;
    prefabTag: string;
    propertyName: string;
    params?: any;
    isChildren: boolean;
}

class UIHookOperator extends F.HookOperatorBase {
    private systemInstanceMap = new Map<any /** typeof F.System */, F.System>();
    private subscribeHelperMap = new Map<any /** typeof F.System */, F.SubscribeHelper>();
    private originalStores = new Map<number, F.Store>();
    private eventRegistries = new Map<any /** typeof F.System */, UIEventInfo[]>();
    private prefabBindRegistries = new Map<any /** typeof F.Store */, UIPrefabBindInfo[]>();
    private unityEventHandles = new Map<number /** store.id */, number[] /** F.SubscribeHandle */>();

    // /////////////////////////////////////////////////////////
    // HookOperatorBase interface
    public inheritFrom(_source: F.HookOperatorBase, _dataInheritType: F.EDataInheritType): void {}

    public getDescription(): string {
        return "UnityUIDecorator";
    }

    public getHookType(): F.HookType | F.HookType[] {
        return [F.HookType.onSystemPostCreate, F.HookType.onStorePostCreate, F.HookType.onSystemPreDestroy, F.HookType.onStorePreDestroy];
    }

    public onSystemPostCreate(system: F.System, _subscribeHelper: F.SubscribeHelper) {
        this.systemInstanceMap.set(system.constructor, system);
        this.subscribeHelperMap.set(system.constructor, _subscribeHelper);
    }

    public onSystemPreDestroy(system: F.System, _subscribeHelper: F.SubscribeHelper) {
        this.systemInstanceMap.delete(system.constructor);
        this.subscribeHelperMap.delete(system.constructor);
    }

    public onStorePostCreate(store: F.Store, _proxy: F.StoreProxy) {
        this.originalStores.set(store.id, store);
    }

    public onStorePreDestroy(store: F.Store) {
        this.originalStores.delete(store.id);
    }

    // /////////////////////////////////////////////////////////
    // 处理事件绑定
    public registerUnityEvent(systemCtor: any, objectName: string, componentName: string, eventName: string, callback: (...args: any[]) => void) {
        let eventInfoList = this.eventRegistries.get(systemCtor) || [];
        eventInfoList.push({ objectName, componentName, eventName, callback });
        this.eventRegistries.set(systemCtor, eventInfoList);
    }

    public registerPrefabBind(storeCtor: any, objectName: string, prefabTag: string, propertyName: string, params?: any, isChildren = false) {
        let prefabBindInfoList = this.prefabBindRegistries.get(storeCtor) || [];
        prefabBindInfoList.push({ objectName, prefabTag, propertyName, params, isChildren });
        this.prefabBindRegistries.set(storeCtor, prefabBindInfoList);
    }

    public bindRegisteredEvent(store: F.RStore, prefabProxy: PrefabProxy) {
        let systemCtor = F.getStoreOwnerCtor(store);

        let eventInfoList = this.eventRegistries.get(systemCtor);
        if (eventInfoList === undefined || eventInfoList?.length === 0) return;

        let systemInstance = this.systemInstanceMap.get(systemCtor);
        F.assert(systemInstance, "systemInstance is null");

        let subscribeHelper = this.subscribeHelperMap.get(systemCtor);
        F.assert(subscribeHelper, "systemInstance is null");

        let handles = eventInfoList.map((info) => {
            let finalCallback = (...args: any[]) => info.callback.call(systemInstance, store, ...args);
            let component = (prefabProxy as unknown as PrefabProxy<any>).getGameObject(info.objectName).GetComponent(info.componentName);
            F.assert(component, `component is null, childObjectName=${info.objectName}, componentName=${info.componentName}`);
            let event = Reflect.get(component, info.eventName);
            F.assert(event, `event is null, childObjectName=${info.objectName}, componentName=${info.componentName}, eventName=${info.eventName}`);
            return subscribeHelper!.subscribe(event, finalCallback);
        });

        handles && this.unityEventHandles.set(store.id, handles);
    }

    public unbindRegisteredEvent(store: F.RStore) {
        let systemCtor = F.getStoreOwnerCtor(store);
        let subscribeHelper = this.subscribeHelperMap.get(systemCtor);
        let handles = this.unityEventHandles.get(store.id);
        handles?.forEach((handle) => subscribeHelper?.unsubscribeWithHandle(handle));
    }

    public bindRegisteredPrefab(store: F.RStore, prefabProxy: PrefabProxy<any>) {
        let storeCtor = store.constructor;
        let prefabBindInfoList = this.prefabBindRegistries.get(storeCtor);
        if (prefabBindInfoList === undefined) return;

        for (let { objectName, propertyName, prefabTag, params, isChildren } of prefabBindInfoList) {
            let prefabStore = isChildren ? prefabProxy.bindChildrenPrefab(objectName, store, prefabTag, params) : prefabProxy.bindPrefab(objectName, store, prefabTag, params);
            Object.defineProperty(store, propertyName, { value: prefabStore });
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
            Object.defineProperty(store, propertyName, { value: undefined });
        }
    }
}

@D.system(UNITY_UI_SYSTEM_TAG)
class UIDecoratorSystem extends F.System {
    @D.linkUtil(_bindRes)
    protected bindRes(store: F.RStore, prefabProxy: PrefabProxy<any>) {
        let operator = F.HookUtil.get(UIHookOperator, true);
        operator.bindRegisteredPrefab(store, prefabProxy);
        operator.bindRegisteredEvent(store, prefabProxy);
    }

    @D.linkUtil(_unbindRes)
    protected unbindRes(store: F.RStore) {
        let operator = F.HookUtil.get(UIHookOperator, true);
        operator.unbindRegisteredEvent(store);
        operator.unbindRegisteredPrefab(store);
    }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class UT<T, K = unknown> {}

declare module "k-ts-framework" {
    namespace D {
        /**
         * 订阅一个 UI 事件
         * @param prefabProxyType @example UI.UT<CS.PrefabProxy.UILogin>
         */
        export function on<
            TPrefabProxy extends CS.PrefabProxy.Base,
            TChildObjectName extends keyof TPrefabProxy,
            TComponentName extends keyof TPrefabProxy[TChildObjectName],
            TEventName extends {
                [K in keyof TPrefabProxy[TChildObjectName][TComponentName]]: TPrefabProxy[TChildObjectName][TComponentName][K] extends SupportedUnityEvent ? K : never;
            }[keyof TPrefabProxy[TChildObjectName][TComponentName]],
        >(prefabProxyType: F.Constructor<UT<TPrefabProxy>>, objectName: TChildObjectName, componentName: TComponentName, eventName: TEventName): any;
    }
}

function delegateOn(target: any, functionName: string | symbol, descriptor: PropertyDescriptor, ...args: any[]): boolean {
    if (args[0] !== UT) return false;
    let callback = target[functionName];
    F.HookUtil.get(UIHookOperator, true)?.registerUnityEvent(target.constructor, /** childObjectName */ args[1], /** componentName */ args[2], /** eventName */ args[3], callback);
    return true;
}

F.HookUtil.get(F.SubscribeHook).registerOnDecorator(delegateOn);

export function bind<TPrefabProxy extends CS.PrefabProxy.Base, TChildObjectName extends keyof TPrefabProxy, TBindParams>(
    _: F.Constructor<UT<TPrefabProxy, TBindParams>>, // UT<CS.PrefabProxy.UILogin, WndFrameNode.IBindParams> 没啥运行时作用，只是为了让 TS 编译器知道类型
    objectName: TChildObjectName,
    prefabTag: string,
    params?: TBindParams,
): any {
    return (store: any, propertyName: string) => {
        F.HookUtil.get(UIHookOperator, true)?.registerPrefabBind(store.constructor, objectName as string, prefabTag, propertyName, params);
    };
}

export function bindChildren<TPrefabProxy extends CS.PrefabProxy.Base, TChildObjectName extends keyof TPrefabProxy, TBindParams>(
    _: F.Constructor<UT<TPrefabProxy, TBindParams>>, // UT<CS.PrefabProxy.UILogin, WndFrameNode.IBindParams> 没啥运行时作用，只是为了让 TS 编译器知道类型
    objectName: TChildObjectName,
    prefabTag: string,
    params?: TBindParams | TBindParams[],
): any {
    return (store: any, propertyName: string) => {
        F.HookUtil.get(UIHookOperator, true)?.registerPrefabBind(store.constructor, objectName as string, prefabTag, propertyName, params, true);
    };
}
