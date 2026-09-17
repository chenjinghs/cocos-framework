/* eslint-disable @typescript-eslint/member-ordering */
/* eslint-disable @typescript-eslint/method-signature-style */

import { F } from "k-ts-framework";

import { SupportedUnityEvent, UnityEventWrapper } from "./UnityEventWrapper";

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// Unity Event
declare module "../../k-ts-framework/dist/framework/System" {
    export interface System {
        /**
         * 订阅 Unity Event
         * @param event Unity Event
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        subscribe(event: SupportedUnityEvent, callback: F.CallbackType, thisArg?: System, description?: string): number;

        /**
         * 订阅 Unity Event，并指定 Handle
         * @param handle: 外部指定的Handle，不能为空
         * @param delegate Unity Event
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         */
        subscribeWithHandle(handle: symbol, event: SupportedUnityEvent, callback: F.CallbackType, thisArg?: System, description?: string): void;

        /**
         * 订阅 Unity Event
         * @param event Unity Event
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        newPromise<T extends CSUnityObject>(asyncHandle: symbol, event: SupportedUnityEvent, callback?: F.CallbackType, thisArg?: System, description?: string): Promise<T | undefined>;
    }
}

class DelegateSubscriber implements F.ISubscriber {
    public canProcess(event: SupportedUnityEvent): boolean {
        return event instanceof SupportedUnityEvent;
    }

    public equal(sourceArgs: any[], targetArgs: any[]): boolean {
        // event, callback, thisArgs(option)
        return F.checkArgsEqual(sourceArgs, targetArgs, 2, 3);
    }

    public subscribe(info: F.SubscribeInstanceInfo, event: SupportedUnityEvent, callback: F.CallbackType, thisArg?: F.System, description?: string): UnityEventWrapper {
        F.assert(info.resolve || callback, `subscribe event failed, callback is invalid`);

        let newCallback = F.verifySubscriberCallback(info, callback ?? F.EMPTY_CALLBACK, thisArg, DelegateSubscriber.resolveValueFunc, description);
        return UnityEventWrapper.addListener(event, newCallback, thisArg, description);
    }

    public unsubscribe<T extends F.CallbackType>(info: F.SubscribeInstanceInfo, _event: SupportedUnityEvent, _callback?: T, _thisArg?: F.System): boolean {
        (info.subscribeResult as UnityEventWrapper).removeListener();
        return true;
    }

    public getInfo<T extends F.CallbackType>(info: F.SubscribeInstanceInfo | undefined, event: SupportedUnityEvent, callback?: T, thisArg?: F.System, description?: string): string {
        return `event ${event}, system ${thisArg?.constructor.name}, description: ${description || (info?.subscribeResult as UnityEventWrapper)?.getInfo()}, callback: ${callback}`;
    }

    private static resolveValueFunc(_callbackResult: any, ...args: any[]) {
        return args;
    }
}

F.HookUtil.get(F.SubscribeHook).registerSubscriber(DelegateSubscriber);

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// Async load
type CSUnityObject = CS.UnityEngine.Object;
type CSUnityGameObject = CS.UnityEngine.GameObject;
const CSNewResourceUtil = CS.NewResourceUtil;
export type LoadCallbackType = (obj: CS.UnityEngine.Object | undefined) => void;

namespace InnerLoadUtil {
    let weakResMap = new WeakMap<CS.UnityEngine.Object, Array<CS.ResourceRef>>();

    // eslint-disable-next-line no-inner-declarations
    function addWeakRefAndReturnObj(ref: CS.ResourceRef) {
        if (ref === undefined) return;

        let retObj = ref.Get();
        if (retObj === undefined) return;

        let refs = weakResMap.get(retObj);
        if (!refs) {
            refs = new Array<CS.ResourceRef>();
            weakResMap.set(retObj, refs);
        }
        refs.push(ref);
        return retObj;
    }

    // 下面这几个带New的口子必须传以项目根目录为起点的相对路径
    // 比如 Assets/Resources/UI/Achievement/AchievementMain.prefab
    // parent则是某个资源需要跟随哪个GameObject的生命周期而销毁，可不传
    export function loadSyncAndInstantiate(path: string, parent: CSUnityGameObject, name?: string) {
        F.assert(path !== undefined && path.trim() !== "", "path is empty");

        return CSNewResourceUtil.LoadSyncAndInstantiate(path, parent, name);
    }

    export function loadAsyncAndInstantiate(path: string, name: string, callback: LoadCallbackType, parent?: CSUnityGameObject) {
        F.assert(path !== undefined && path.trim() !== "", "path is empty");

        return CSNewResourceUtil.LoadAsyncAndInstantiate(path, parent!, name, callback);
    }

    export function loadSync(path: string, parent?: CSUnityGameObject) {
        F.assert(path !== undefined && path.trim() !== "", "path is empty");

        if (parent) {
            return CSNewResourceUtil.LoadSyncWithOwner(path, parent);
        } else {
            let ref = CSNewResourceUtil.LoadSync(path);
            return addWeakRefAndReturnObj(ref);
        }
    }

    export function loadAsync(path: string, callback: LoadCallbackType, parent?: CSUnityGameObject) {
        F.assert(path !== undefined && path.trim() !== "", "path is empty");

        if (parent) {
            return CSNewResourceUtil.LoadAsyncWithOwner(path, parent, (obj) => {
                callback(obj);
            });
        } else {
            return CSNewResourceUtil.LoadAsync(path, (ref) => {
                callback(addWeakRefAndReturnObj(ref));
            });
        }
    }

    // 加载sprite，atlasPath也需要传全路径，比如：Assets/New/Art/Atlas/aa.spriteatlas，spriteName则是aa里面的某个sprite的名字
    export function loadSpriteSync(spritePath: string, parent: CSUnityGameObject) {
        return CSNewResourceUtil.LoadSpriteSyncWithOwner(spritePath, parent);
    }

    export function loadSpriteAsync(spritePath: string, callback: LoadCallbackType, parent: CSUnityGameObject) {
        return CSNewResourceUtil.LoadSpriteAsyncWithOwner(spritePath, parent, callback);
    }

    export function loadSceneSync(sceneName: string) {
        F.assert(sceneName !== undefined && sceneName.trim() !== "", "sceneName is empty");

        CSNewResourceUtil.LoadSceneSync(sceneName);
    }

    export function loadSceneAsync(sceneName: string, callback: () => {}) {
        F.assert(sceneName !== undefined && sceneName.trim() !== "", "sceneName is empty");

        return CSNewResourceUtil.LoadSceneAsync(sceneName, callback);
    }
}

export namespace ResourceUtil {
    export const loadSyncAndInstantiate = InnerLoadUtil.loadSyncAndInstantiate;
    export const loadSync = InnerLoadUtil.loadSync;
    export const loadSpriteSync = InnerLoadUtil.loadSpriteSync;
    export const loadSceneSync = InnerLoadUtil.loadSceneSync;
}

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// Async Load
export type ICancelableRequest = { Cancel: () => void };
export interface IAsyncLoader {
    loadSceneAsync: (sceneName: string, callback: () => {}) => ICancelableRequest;
    loadAsyncAndInstantiate: (path: string, name: string, callback: LoadCallbackType, parent?: CSUnityGameObject) => ICancelableRequest;
    loadSpriteAsync: (spritePath: string, callback: LoadCallbackType, parent: CSUnityGameObject) => ICancelableRequest;
    loadAsync: (path: string, callback: LoadCallbackType, parent?: CSUnityGameObject) => void;
}

// 默认实现都用系统的
export const DEFAULT_ENV_ASYNC_LOADER = {
    loadSceneAsync: InnerLoadUtil.loadSceneAsync,
    loadAsyncAndInstantiate: InnerLoadUtil.loadAsyncAndInstantiate,
    loadSpriteAsync: InnerLoadUtil.loadSpriteAsync,
    loadAsync: InnerLoadUtil.loadAsync,
};

export const ASYNC_LOAD = Symbol("AsyncLoad");
export const ASYNC_LOAD_SPRITE = Symbol("AsyncLoadSprite");
export const ASYNC_LOAD_AND_INSTANTIATE = Symbol("AsyncLoadAndInstantiate");
export const ASYNC_LOAD_SCENE = Symbol("AsyncLoadScene");

export type ASYNC_LOAD_TYPE = typeof ASYNC_LOAD | typeof ASYNC_LOAD_SPRITE | typeof ASYNC_LOAD_AND_INSTANTIATE;
export type AsyncLoadCallbackType = <T extends CSUnityObject>(loadedObject: T | undefined) => void;
export type MultiAsyncLoadCallbackType = <T extends CSUnityObject>(loadedObject: T[]) => void;

class AsyncLoadEnvData implements F.IEnvData {
    public loader = DEFAULT_ENV_ASYNC_LOADER as IAsyncLoader;
    public inheritFrom(source: AsyncLoadEnvData): void {
        this.loader = source.loader;
    }
}

export function setAsyncLoader(env: number | string | F.Env, loader: IAsyncLoader) {
    let foundEnv = F.Env.find(env);
    F.assert(foundEnv && foundEnv.length > 0, `invalid env ${env}`);
    foundEnv[0].getData(AsyncLoadEnvData).loader = loader;
}

export function getAsyncLoader(env: number | string | F.Env): IAsyncLoader {
    let foundEnv = F.Env.find(env);
    F.assert(foundEnv && foundEnv.length > 0, `invalid env ${env}`);
    return foundEnv[0].getData(AsyncLoadEnvData).loader;
}

// 必须这么引，直接引k-ts-framework + namespace F会让全局F.System被替换
declare module "../../k-ts-framework/dist/framework/System" {
    export interface System {
        /**
         * 订阅异步加载
         * @param asyncLoadKey 必须为ASYNC_LOAD_TYPE
         * @param resourcePath 资源路径
         * @param name 资源名字，可选
         * @param parent 挂载在某个GameObject下，可选
         * @param callback 回调函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        subscribe<T extends AsyncLoadCallbackType>(
            asyncLoadKey: ASYNC_LOAD_TYPE,
            resourcePath: string,
            name: string | undefined,
            parent: NonNullable<CSUnityGameObject>,
            callback: T,
            thisArg?: System,
            description?: string,
        ): number;

        subscribe<T extends AsyncLoadCallbackType>(
            asyncLoadKey: typeof ASYNC_LOAD_SCENE,
            resourcePath: string,
            name: string | undefined,
            parent: CSUnityGameObject | undefined,
            callback: T,
            thisArg?: System,
            description?: string,
        ): number;

        /**
         * 订阅异步加载
         * @param asyncLoadKey 必须为ASYNC_LOAD_TYPE
         * @param resourcePaths 资源路径
         * @param names 资源名字，可选
         * @param parent 挂载在某个GameObject下，可选
         * @param callback 回调函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        subscribe<T extends MultiAsyncLoadCallbackType>(
            asyncLoadKey: ASYNC_LOAD_TYPE,
            // eslint-disable-next-line @typescript-eslint/unified-signatures
            resourcePaths: string[],
            names: string[] | undefined,
            parent: NonNullable<CSUnityGameObject> | NonNullable<CSUnityGameObject>[],
            callback: T,
            thisArg?: System,
            description?: string,
        ): number;

        /**
         * 订阅异步加载，并指定 Handle
         * @param handle: 外部指定的Handle，不能为空
         * @param asyncLoadKey 必须为ASYNC_LOAD_TYPE
         * @param resourcePath 资源路径
         * @param name 资源名字，可选
         * @param parent 挂载在某个GameObject下，可选
         * @param callback 回调函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         */
        subscribeWithHandle<T extends AsyncLoadCallbackType>(
            handle: symbol,
            asyncLoadKey: ASYNC_LOAD_TYPE,
            resourcePath: string,
            name: string | undefined,
            parent: NonNullable<CSUnityGameObject>,
            callback: T,
            thisArg?: System,
            description?: string,
        ): void;

        /**
         * 订阅异步加载，并指定 Handle
         * @param handle: 外部指定的Handle，不能为空
         * @param asyncLoadKey 必须为ASYNC_LOAD_TYPE
         * @param resourcePaths 资源路径
         * @param names 资源名字，可选
         * @param parent 挂载在某个GameObject下，可选
         * @param callback 回调函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         */
        subscribeWithHandle<T extends MultiAsyncLoadCallbackType>(
            handle: symbol,
            asyncLoadKey: ASYNC_LOAD_TYPE,
            // eslint-disable-next-line @typescript-eslint/unified-signatures
            resourcePaths: string[],
            names: string[] | undefined,
            parent: NonNullable<CSUnityGameObject> | NonNullable<CSUnityGameObject>[],
            callback: T,
            thisArg?: System,
            description?: string,
        ): void;

        /**
         * 订阅异步加载
         * @param asyncLoadKey 必须为ASYNC_LOAD
         * @param resourcePath 资源路径
         * @param name 资源名字，可选
         * @param parent 挂载在某个GameObject下，可选
         * @param callback 回调函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        newPromise<T extends CSUnityObject>(
            asyncHandle: symbol,
            asyncLoadKey: ASYNC_LOAD_TYPE,
            resourcePath: string,
            name: string | undefined,
            parent: NonNullable<CSUnityGameObject>,
            callback?: AsyncLoadCallbackType,
            thisArg?: System,
            description?: string,
        ): Promise<T | undefined>;

        /**
         * 订阅异步加载
         * @param asyncLoadKey 必须为ASYNC_LOAD
         * @param resourcePaths 资源路径
         * @param names 资源名字，可选
         * @param parent 挂载在某个GameObject下，可选
         * @param callback 回调函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        newPromise<T extends CSUnityObject>(
            asyncHandle: symbol,
            asyncLoadKey: ASYNC_LOAD_TYPE,
            resourcePaths: string[],
            names: string[] | undefined,
            parent: NonNullable<CSUnityGameObject> | NonNullable<CSUnityGameObject>[],
            callback?: MultiAsyncLoadCallbackType,
            thisArg?: System,
            description?: string,
        ): Promise<T[]>;

        newPromise(
            asyncHandle: symbol,
            asyncLoadKey: typeof ASYNC_LOAD_SCENE,
            resourcePath: string,
            name?: string,
            parent?: CSUnityGameObject,
            callback?: AsyncLoadCallbackType,
            thisArg?: System,
            description?: string,
        ): Promise<void>;
    }
}

class AsyncLoadSubscriber implements F.ISubscriber {
    private static keys = new Set<symbol>([ASYNC_LOAD, ASYNC_LOAD_SPRITE, ASYNC_LOAD_AND_INSTANTIATE, ASYNC_LOAD_SCENE]);

    public canProcess(asyncLoadKey: ASYNC_LOAD_TYPE): boolean {
        return AsyncLoadSubscriber.keys.has(asyncLoadKey);
    }

    public equal(_sourceArgs: any[], _targetArgs: any[]): boolean {
        return false;
    }

    public subscribe<T extends F.CallbackType>(
        info: F.SubscribeInstanceInfo,
        asyncLoadKey: ASYNC_LOAD_TYPE,
        resourcePath: string | string[],
        names: string | string[] | undefined,
        parents: CSUnityGameObject | CSUnityGameObject[] | undefined,
        callback?: T,
        thisArg?: F.System,
        description?: string,
    ) {
        F.assert(info.resolve || callback, `subscribe async load failed, callback is invalid`);

        let newCallback = F.verifySubscriberCallback(info, callback, thisArg, AsyncLoadSubscriber.resolveValueFunc, description);
        let resPaths = Array.isArray(resourcePath) ? resourcePath : [resourcePath];
        let requests = new Array<ICancelableRequest>();

        let allFinishedCallback;
        if (!Array.isArray(resourcePath)) {
            allFinishedCallback = newCallback;
        } else {
            let count = resPaths.length;
            if (count === 0) {
                newCallback([]);
                return;
            }

            let results = new Array<CSUnityObject>();
            results.length = count;
            allFinishedCallback = (obj: CSUnityObject, index: number) => {
                // if (obj) results.push(obj);
                // 就算是undefined也要保证顺序
                results[index] = obj;
                if (--count > 0) return;
                newCallback(results);
            };
        }

        let loader = F.Env.getCurrentData(AsyncLoadEnvData).loader;
        for (let i = 0; i < resPaths.length; ++i) {
            let resPath = resPaths[i];
            let name = Array.isArray(names) ? names[i] : names;
            let parent = Array.isArray(parents) ? parents[i] : parents;
            let request = AsyncLoadSubscriber.loadSingle(loader, asyncLoadKey, resPath, name, parent, (obj: CSUnityObject) => {
                // 为了保序
                allFinishedCallback(obj, i);
            });
            if (request) requests.push(request);
            else allFinishedCallback(undefined, i);
        }

        return requests;
    }

    public unsubscribe(info: F.SubscribeInstanceInfo): boolean {
        let requests = info.subscribeResult as Array<CS.ResourceLoadRequest>;
        for (let request of requests) {
            request.Cancel();
        }
        requests.length = 0;
        return true;
    }

    public getInfo<T extends F.CallbackType>(
        info: F.SubscribeInstanceInfo | undefined,
        _asyncLoadKey: ASYNC_LOAD_TYPE,
        resourcePath: string | string[],
        callback: T,
        thisArg?: F.System,
        description?: string,
    ): string {
        let requests = (info?.subscribeResult as Array<CS.ResourceLoadRequest>) ?? [];
        let files = "";
        for (let request of requests) {
            files += request.GetPath() + ", ";
        }
        return `async load ${resourcePath.toString()}, system ${thisArg?.constructor.name}, files: ${files}, description: ${description}, callback: ${callback}`;
    }

    private static loadSingle(
        loader: IAsyncLoader,
        loadType: ASYNC_LOAD_TYPE | typeof ASYNC_LOAD_SCENE,
        resPath: string,
        name: string | undefined,
        parent: CSUnityGameObject | undefined,
        callback: any,
    ) {
        switch (loadType) {
            case ASYNC_LOAD_SCENE:
                return loader.loadSceneAsync(resPath, callback);
            case ASYNC_LOAD_AND_INSTANTIATE:
                return loader.loadAsyncAndInstantiate(resPath, name!, callback, parent);
            case ASYNC_LOAD_SPRITE:
                F.assert(parent, "loadSpriteAsync must have parent");
                return loader.loadSpriteAsync(resPath, callback, parent);
            case ASYNC_LOAD:
                return loader.loadAsync(resPath, callback, parent);
            default:
                F.assert(false, `loadSingle failed, loadType ${loadType} is invalid`);
        }
    }

    private static resolveValueFunc(_callbackResult: any, loadedObjs: CSUnityObject[] | CSUnityObject) {
        return loadedObjs;
    }
}

F.HookUtil.get(F.SubscribeHook).registerSubscriber(AsyncLoadSubscriber);
