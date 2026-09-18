/* eslint-disable @typescript-eslint/adjacent-overload-signatures */
/* eslint-disable @typescript-eslint/method-signature-style */

import { F } from "k-ts-framework";

import { RUIStore, UIResType, UITagType } from "./Define";

export const ASYNC_CREATE_PREFAB = Symbol("AsyncCreatePrefab");
export const createPrefabAsync = F.createUtilLinker<(owner: F.RStore, tag: UITagType, parent?: UIResType, params?: any, callback?: (uiStore: RUIStore) => void) => { cancel: () => void }>();

export const ASYNC_OPEN_WND = Symbol("AsyncOpenWnd");
export const openWndAsync = F.createUtilLinker<(wndTag: UITagType, params?: any, overrideLayer?: number, callback?: () => void) => { cancel: () => void }>();

// prettier-ignore
declare module "k-ts-framework/dist/framework/System" {
    export interface System {
        /**
         * 异步创建一个 Prefab
         * @param type ASYNC_CREATE_PREFAB
         * @param owner ui logic store (非 RUIStore)
         * @param tag UI tag
         * @param parent UI 根节点，不传的话默认挂载 owner ui 的根节点下
         * @param params 传递给 prefab 的参数
         */
        subscribe<T>(type: typeof ASYNC_CREATE_PREFAB, owner: F.RStore, tag: UITagType, parent?: UIResType, params?: T, callback?: (uiStore: RUIStore) => void, thisArg?: System, description?: string): number;

        /**
         * 异步创建一个 Prefab
         * @param type ASYNC_CREATE_PREFAB
         * @param owner ui logic store (非 RUIStore)
         * @param tag UI tag
         * @param parent UI 根节点，不传的话默认挂载 owner ui 的根节点下
         * @param params 传递给 prefab 的参数
         */
        subscribeWithHandle<T>(handle: symbol, type: typeof ASYNC_CREATE_PREFAB, owner: F.RStore, tag: UITagType, parent?: UIResType, params?: T, callback?: (uiStore: RUIStore) => void, thisArg?: System, description?: string): void;

        /**
         * 异步创建一个 Prefab
         * @param type ASYNC_CREATE_PREFAB
         * @param owner ui logic store (非 RUIStore)
         * @param tag UI tag
         * @param parent UI 根节点，不传的话默认挂载 owner ui 的根节点下
         * @param params 传递给 prefab 的参数
         */
        newPromise<T>(asyncHandle: symbol, type: typeof ASYNC_CREATE_PREFAB, owner: F.RStore, tag: UITagType, parent?: UIResType, params?: T, callback?: (uiStore: RUIStore) => void, thisArg?: System, description?: string): Promise<RUIStore>;

        /**
         * 异步打开一个窗口
         * @param type ASYNC_OPEN_WND
         * @param wndTag UI tag
         * @param params 传递给窗口的参数
         * @param callback 可选的回调
         * @param thisArg 可选的上下文
         * @param description 描述信息
         */
        subscribe<T>(type: typeof ASYNC_OPEN_WND, wndTag: UITagType, params?: T, overrideLayer?: number, callback?: () => void, thisArg?: System, description?: string): number;

        /**
         * 异步打开一个窗口
         * @param type ASYNC_OPEN_WND
         * @param wndTag UI tag
         * @param params 传递给窗口的参数
         * @param callback 可选的回调
         * @param thisArg 可选的上下文
         * @param description 描述信息
         */
        subscribeWithHandle<T>(handle: symbol, type: typeof ASYNC_OPEN_WND, wndTag: UITagType, params?: T, overrideLayer?: number, callback?: () => void , thisArg?: System, description?: string): void;

        /**
         * 异步打开一个窗口
         * @param type ASYNC_OPEN_WND
         * @param wndTag UI tag
         * @param params 传递给窗口的参数
         * @param callback 可选的回调
         * @param thisArg 可选的上下文
         * @param description 描述信息
         */
        newPromise<T>(asyncHandle: symbol, type: typeof ASYNC_OPEN_WND, wndTag: UITagType, params?: T, overrideLayer?: number, callback?: () => void , thisArg?: System, description?: string): Promise<void>;
    }
}

// prettier-ignore
export class AsyncCreatePrefabSubscriber implements F.ISubscriber {
    public canProcess(type: unknown): boolean {
        return type === ASYNC_CREATE_PREFAB;
    }

    public equal(_sourceArgs: any[], _targetArgs: any[]): boolean {
        return false;
    }

    public subscribe(info: F.SubscribeInstanceInfo, _type: typeof ASYNC_CREATE_PREFAB, owner: F.RStore, tag: UITagType, parent?: UIResType, params?: any, callback?: (uiStore:RUIStore) => void , thisArg?: F.System, description?: string) {
        callback = callback ?? ((uiStore) => uiStore); // 允许不传 callback
        let newCallback = F.verifySubscriberCallback(info, callback, thisArg, AsyncCreatePrefabSubscriber.resolveValueFunc, description);
        return createPrefabAsync(owner, tag, parent, params, newCallback);
    }

    public unsubscribe(info: F.SubscribeInstanceInfo): boolean {
        let subscribeResult = info.subscribeResult as { cancel:() => void } | undefined;
        subscribeResult?.cancel();
        return true;
    }

    public getInfo<T extends F.CallbackType>(info: F.SubscribeInstanceInfo | undefined, _type: typeof ASYNC_CREATE_PREFAB, tag: UITagType, callback?: T, thisArg?: F.System, description?: string): string {
        return `async createPrefab, tag: ${tag}, system ${thisArg?.constructor.name}, callback: ${callback}, description: ${description}`;
    }

    public static resolveValueFunc(uiStore: RUIStore) {
        return uiStore;
    }
}

// prettier-ignore
export class AsyncOpenWndSubscriber implements F.ISubscriber {
    public canProcess(type: unknown): boolean {
        return type === ASYNC_OPEN_WND;
    }

    public equal(_sourceArgs: any[], _targetArgs: any[]): boolean {
        return false;
    }

    public subscribe(info: F.SubscribeInstanceInfo, _type: typeof ASYNC_OPEN_WND, wndTag: UITagType, params?: any, overrideLayer?: number, callback?: () => void, thisArg?: F.System, description?: string) {
        callback = callback ?? (() => {}); // 允许不传 callback
        let newCallback = F.verifySubscriberCallback(info, callback, thisArg, AsyncOpenWndSubscriber.resolveValueFunc, description);
        return openWndAsync(wndTag, params, overrideLayer, newCallback);
    }

    public unsubscribe(info: F.SubscribeInstanceInfo): boolean {
        let subscribeResult = info.subscribeResult as { cancel:() => void } | undefined;
        subscribeResult?.cancel();
        return true;
    }

    public getInfo<T extends F.CallbackType>(info: F.SubscribeInstanceInfo | undefined, _type: typeof ASYNC_OPEN_WND, wndTag: UITagType, callback?: T, thisArg?: F.System, description?: string): string {
        return `async openWnd, tag: ${wndTag}, system ${thisArg?.constructor.name}, callback: ${callback}, description: ${description}`;
    }

    public static resolveValueFunc(uiStore: RUIStore) {
        return uiStore;
    }
}

F.HookUtil.get(F.SubscribeHook).registerSubscriber(AsyncCreatePrefabSubscriber);
F.HookUtil.get(F.SubscribeHook).registerSubscriber(AsyncOpenWndSubscriber);
