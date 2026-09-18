import { F } from "k-ts-framework";

import { cc } from "./cc";
import { instantiatePrefab, loadAsset, loadScene } from "./ResourceUtil";

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// Async load
export type LoadCallbackType = (obj: cc.Asset | cc.Node | undefined) => void;
export type ICancelableRequest = { Cancel: () => void };

namespace InnerLoadUtil {
    // 下面这几个带New的口子必须传以 resources 为起点的相对路径，比如 "ui/Login/LoginMain.prefab"
    // parent则是某个资源需要跟随哪个Node的生命周期而销毁，可不传
    export function loadAsyncAndInstantiate(path: string, name: string, callback: LoadCallbackType, parent?: cc.Node): ICancelableRequest {
        F.assert(path !== undefined && path.trim() !== "", "path is empty");

        let cancelled = false;
        loadAsset<cc.Prefab>("resources", path)
            .then((prefab) => {
                if (cancelled) return;
                let node = instantiatePrefab(prefab);
                if (name) node.name = name;
                if (parent) parent.addChild(node);
                callback(node);
            })
            .catch((err: unknown) => {
                console.error(`loadAsyncAndInstantiate failed, path: ${path}`, err);
                if (!cancelled) callback(undefined);
            });

        return { Cancel: () => (cancelled = true) };
    }

    // parent 在 Unity 版用于资源随宿主销毁（LoadAsyncWithOwner）；cc 侧由 instantiate 后的节点生命周期接管，这里暂不追踪
    export function loadAsync(path: string, callback: LoadCallbackType, _parent?: cc.Node): void {
        F.assert(path !== undefined && path.trim() !== "", "path is empty");

        loadAsset<cc.Asset>("resources", path)
            .then((asset) => {
                callback(asset);
            })
            .catch((err: unknown) => {
                console.error(`loadAsync failed, path: ${path}`, err);
                callback(undefined);
            });
    }

    // 加载sprite，spritePath为 resources 下路径；加载完成后设置到 parent 节点的 Sprite 组件上
    export function loadSpriteAsync(spritePath: string, callback: LoadCallbackType, parent: cc.Node): ICancelableRequest {
        let cancelled = false;
        loadAsset<cc.SpriteFrame>("resources", spritePath)
            .then((spriteFrame) => {
                if (cancelled) return;
                let sprite = parent.getComponent(cc.Sprite);
                if (sprite === null) sprite = parent.addComponent(cc.Sprite);
                sprite.spriteFrame = spriteFrame;
                callback(spriteFrame);
            })
            .catch((err: unknown) => {
                console.error(`loadSpriteAsync failed, path: ${spritePath}`, err);
                if (!cancelled) callback(undefined);
            });

        return { Cancel: () => (cancelled = true) };
    }

    export function loadSceneAsync(sceneName: string, callback: () => void): ICancelableRequest {
        F.assert(sceneName !== undefined && sceneName.trim() !== "", "sceneName is empty");

        let cancelled = false;
        loadScene(sceneName)
            .then(() => {
                if (!cancelled) callback();
            })
            .catch((err: unknown) => {
                console.error(`loadSceneAsync failed, sceneName: ${sceneName}`, err);
            });

        return { Cancel: () => (cancelled = true) };
    }
}

export interface IAsyncLoader {
    loadSceneAsync: (sceneName: string, callback: () => void) => ICancelableRequest;
    loadAsyncAndInstantiate: (path: string, name: string, callback: LoadCallbackType, parent?: cc.Node) => ICancelableRequest;
    loadSpriteAsync: (spritePath: string, callback: LoadCallbackType, parent: cc.Node) => ICancelableRequest;
    loadAsync: (path: string, callback: LoadCallbackType, parent?: cc.Node) => void;
}

// 默认实现走 cc resources
export const DEFAULT_ENV_ASYNC_LOADER: IAsyncLoader = {
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
export type AsyncLoadCallbackType = <T extends cc.Asset | cc.Node>(loadedObject: T | undefined) => void;
export type MultiAsyncLoadCallbackType = <T extends cc.Asset | cc.Node>(loadedObject: T[]) => void;

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

class AsyncLoadSubscriber implements F.ISubscriber {
    private static keys = new Set<symbol>([ASYNC_LOAD, ASYNC_LOAD_SPRITE, ASYNC_LOAD_AND_INSTANTIATE, ASYNC_LOAD_SCENE]);

    public canProcess(asyncLoadKey: ASYNC_LOAD_TYPE): boolean {
        return AsyncLoadSubscriber.keys.has(asyncLoadKey);
    }

    public equal(_sourceArgs: unknown[], _targetArgs: unknown[]): boolean {
        return false;
    }

    public subscribe<T extends F.CallbackType>(
        info: F.SubscribeInstanceInfo,
        asyncLoadKey: ASYNC_LOAD_TYPE,
        resourcePath: string | string[],
        names: string | string[] | undefined,
        parents: cc.Node | cc.Node[] | undefined,
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
                (newCallback as (v: unknown) => void)([]);
                return;
            }

            let results = new Array<cc.Asset | cc.Node>();
            results.length = count;
            allFinishedCallback = (obj: cc.Asset | cc.Node | undefined, index: number) => {
                // 就算是undefined也要保证顺序
                results[index] = obj as cc.Asset | cc.Node;
                if (--count > 0) return;
                newCallback(results);
            };
        }

        let loader = F.Env.getCurrentData(AsyncLoadEnvData).loader;
        for (let i = 0; i < resPaths.length; ++i) {
            let resPath = resPaths[i];
            let name = Array.isArray(names) ? names[i] : names;
            let parent = Array.isArray(parents) ? parents[i] : parents;
            let request = AsyncLoadSubscriber.loadSingle(loader, asyncLoadKey, resPath, name, parent, (obj: cc.Asset | cc.Node | undefined) => {
                // 为了保序
                (allFinishedCallback as (obj: cc.Asset | cc.Node | undefined, index: number) => void)(obj, i);
            });
            if (request) requests.push(request);
            else (allFinishedCallback as (obj: cc.Asset | cc.Node | undefined, index: number) => void)(undefined, i);
        }

        return requests;
    }

    public unsubscribe(info: F.SubscribeInstanceInfo): boolean {
        let requests = info.subscribeResult as Array<ICancelableRequest>;
        for (let request of requests) {
            request.Cancel();
        }
        requests.length = 0;
        return true;
    }

    public getInfo<T extends F.CallbackType>(
        info: F.SubscribeInstanceInfo | undefined,
        asyncLoadKey: ASYNC_LOAD_TYPE,
        resourcePath: string | string[],
        callback: T,
        thisArg?: F.System,
        description?: string,
    ): string {
        let requests = (info?.subscribeResult as Array<ICancelableRequest>) ?? [];
        return `async load ${asyncLoadKey.description}, path: ${resourcePath.toString()}, system ${thisArg?.constructor.name}, requests: ${requests.length}, description: ${description}, callback: ${callback}`;
    }

    private static loadSingle(
        loader: IAsyncLoader,
        loadType: ASYNC_LOAD_TYPE | typeof ASYNC_LOAD_SCENE,
        resPath: string,
        name: string | undefined,
        parent: cc.Node | undefined,
        callback: LoadCallbackType | (() => void),
    ) {
        switch (loadType) {
            case ASYNC_LOAD_SCENE:
                return loader.loadSceneAsync(resPath, callback as () => void);
            case ASYNC_LOAD_AND_INSTANTIATE:
                return loader.loadAsyncAndInstantiate(resPath, name!, callback as LoadCallbackType, parent);
            case ASYNC_LOAD_SPRITE:
                F.assert(parent, "loadSpriteAsync must have parent");
                return loader.loadSpriteAsync(resPath, callback as LoadCallbackType, parent);
            case ASYNC_LOAD:
                loader.loadAsync(resPath, callback as LoadCallbackType, parent);
                return undefined;
            default:
                F.assert(false, `loadSingle failed, loadType ${loadType} is invalid`);
        }
    }

    private static resolveValueFunc(_callbackResult: unknown, loadedObjs: unknown) {
        return loadedObjs;
    }
}

let asyncLoadSubscriberRegistered = false;

/** 注册异步加载订阅器（由 registerKFrameworkCocos 调用，幂等） */
export function registerAsyncLoadSubscriber() {
    if (asyncLoadSubscriberRegistered) return;
    F.HookUtil.get(F.SubscribeHook).registerSubscriber(AsyncLoadSubscriber);
    asyncLoadSubscriberRegistered = true;
}

declare module "k-ts-framework/dist/framework/System" {
    export interface System {
        /**
         * 订阅异步加载
         * @param asyncLoadKey 必须为ASYNC_LOAD_TYPE
         * @param resourcePath 资源路径（resources 下相对路径）
         * @param name 资源名字，可选
         * @param parent 挂载在某个Node下，可选
         * @param callback 回调函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        subscribe<T extends AsyncLoadCallbackType>(
            asyncLoadKey: ASYNC_LOAD_TYPE,
            resourcePath: string,
            name: string | undefined,
            parent: NonNullable<cc.Node>,
            callback: T,
            thisArg?: System,
            description?: string,
        ): number;

        subscribe<T extends AsyncLoadCallbackType>(
            asyncLoadKey: typeof ASYNC_LOAD_SCENE,
            resourcePath: string,
            name: string | undefined,
            parent: cc.Node | undefined,
            callback: T,
            thisArg?: System,
            description?: string,
        ): number;

        /**
         * 订阅异步加载（多资源保序）
         */
        subscribe<T extends MultiAsyncLoadCallbackType>(
            asyncLoadKey: ASYNC_LOAD_TYPE,
            resourcePaths: string[],
            names: string[] | undefined,
            parent: NonNullable<cc.Node> | NonNullable<cc.Node>[],
            callback: T,
            thisArg?: System,
            description?: string,
        ): number;

        subscribeWithHandle<T extends AsyncLoadCallbackType>(
            handle: symbol,
            asyncLoadKey: ASYNC_LOAD_TYPE,
            resourcePath: string,
            name: string | undefined,
            parent: NonNullable<cc.Node>,
            callback: T,
            thisArg?: System,
            description?: string,
        ): void;

        subscribeWithHandle<T extends MultiAsyncLoadCallbackType>(
            handle: symbol,
            asyncLoadKey: ASYNC_LOAD_TYPE,
            resourcePaths: string[],
            names: string[] | undefined,
            parent: NonNullable<cc.Node> | NonNullable<cc.Node>[],
            callback: T,
            thisArg?: System,
            description?: string,
        ): void;

        newPromise<T extends cc.Asset | cc.Node>(
            asyncHandle: symbol,
            asyncLoadKey: ASYNC_LOAD_TYPE,
            resourcePath: string,
            name: string | undefined,
            parent: NonNullable<cc.Node>,
            callback?: AsyncLoadCallbackType,
            thisArg?: System,
            description?: string,
        ): Promise<T | undefined>;

        newPromise<T extends cc.Asset | cc.Node>(
            asyncHandle: symbol,
            asyncLoadKey: ASYNC_LOAD_TYPE,
            resourcePaths: string[],
            names: string[] | undefined,
            parent: NonNullable<cc.Node> | NonNullable<cc.Node>[],
            callback?: MultiAsyncLoadCallbackType,
            thisArg?: System,
            description?: string,
        ): Promise<T[]>;

        newPromise(
            asyncHandle: symbol,
            asyncLoadKey: typeof ASYNC_LOAD_SCENE,
            resourcePath: string,
            name?: string,
            parent?: cc.Node,
            callback?: AsyncLoadCallbackType,
            thisArg?: System,
            description?: string,
        ): Promise<void>;
    }
}
