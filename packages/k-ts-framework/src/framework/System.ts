/* eslint-disable @typescript-eslint/member-ordering */
import { assert } from "../global/GlobalFunctions.js";
import { HookType, HookUtil } from "../misc/HookDefine.js";
import { RuntimeContext } from "../misc/RuntimeContext.js";
import { getManager, IStartAsyncParams, ISystem, NestedTag, StoreConstructor, SystemConstructor } from "./Interface.js";
import { Store } from "./Store.js";

export type AsyncParametersWithoutHandle<T> = T extends (asyncHandle: symbol, ...args: infer P) => any ? P : never;

/**
 * 负责处理函数，无数据
 */
export class System implements ISystem {
    /**
     * 注册类型
     * @param this System类型
     * @param tag 标签
     * @param storeCtors 管理的store类型
     * @param envType 可指定环境类型，默认使用当前环境
     */
    public static register<T extends SystemConstructor, TStoreCtor extends StoreConstructor>(this: T, tag: string, storeCtors?: TStoreCtor | TStoreCtor[], envType?: number) {
        getManager().registerSystem(this, tag, storeCtors, envType);
    }

    /**
     * 注册友元
     * @param systemCtor System类型
     * @param tag 标签
     */
    // public static registerFriend<T extends SystemConstructor>(systemCtor: T, tag: string) {
    //     getManager().registerSystemFriend(systemCtor, tag);
    // }

    /**
     * 根据标签创建System
     * @param tag 标签
     * @returns 是否创建成功
     */
    public static createByTag(tag: NestedTag): boolean {
        return getManager().createSystemByTag(tag);
    }

    /**
     * 根据标签销毁System
     * @param tag 标签
     */
    public static destroyByTag(tag: NestedTag) {
        getManager().destroySystemByTag(tag);
    }

    /**
     * 销毁所有系统
     */
    public static destroyAll() {
        getManager().destroyAllSystems();
    }

    // //////////////////////////////////////////////////////
    /**
     * 初始化
     * @returns 是否初始化成功
     */
    public init() {}

    /**
     * 销毁
     */
    public uninit() {}

    /**
     * 初始化之后回调
     */
    public postInit() {}

    /**
     * 销毁之前回调
     */
    public preUninit() {}

    // ////////////////////////////////////////////////////////////////
    /**
     * 订阅
     * @param args 参数
     * @returns 订阅id，取消订阅时可用
     */
    public subscribe(...args: any[]) {
        // @ts-ignore 此处直接透传，避免因为有函数重载，导致rest参数不识别的报错
        return getManager()
            .getSystemSubscribeHelper(this)
            .subscribe(...args);
    }

    /**
     * 订阅，并指定 Handle
     * @param handle 外部指定的Handle，不能为空
     * @param args 参数
     */
    public subscribeWithHandle(handle: symbol, ...args: any[]): symbol {
        // @ts-ignore 此处直接透传，避免因为有函数重载，导致rest参数不识别的报错
        return getManager()
            .getSystemSubscribeHelper(this)
            .subscribeWithHandle(handle, ...args);
    }

    /**
     * 取消订阅
     * @param args
     * @returns 取消订阅是否成功
     */
    public unsubscribe(...args: any[]): boolean {
        // @ts-ignore 此处直接透传，避免因为有函数重载，导致rest参数不识别的报错
        return getManager()
            .getSystemSubscribeHelper(this)
            .unsubscribe(...args);
    }

    /**
     * 通过 Handle 取消订阅
     * @param handle 外部指定的Handle
     * @returns 取消订阅是否成功
     */
    public unsubscribeWithHandle(handle: symbol | number): boolean {
        return getManager().getSystemSubscribeHelper(this).unsubscribeWithHandle(handle);
    }

    /**
     * 通过 Handles 取消订阅
     * @param handles 外部指定的Handle数组
     * @returns 取消订阅是否成功
     */
    public unsubscribeWithHandles(handles: Array<symbol | number>) {
        let helper = getManager().getSystemSubscribeHelper(this);
        for (const handle of handles) {
            helper.unsubscribeWithHandle(handle);
        }
    }

    /**
     * 检查是否有订阅
     * @param handle
     * @returns
     */
    public hasSubscribed(handle: symbol | number): boolean {
        return getManager().getSystemSubscribeHelper(this).hasSubscribed(handle);
    }

    /**
     * 取消订阅所有的函数
     *
     */
    public unsubscribeAll(includeAsync = true) {
        getManager().getSystemSubscribeHelper(this).unsubscribeAll(includeAsync);
    }

    // //////////////////////////////////////////////////////////////////
    // 异步相关
    // 这里将原生的promise包了一层，并且约束了很多行为，一切目的是为了能够更好的管理运行中的promise，防止出错，特性如下：
    // 1. 一个Async代表一个Promise链，startAsync后，通过await newPromise(asyncHandle, ...)可以顺序执行异步行为，默认Async中不能同时起多个Promise（目的为了防止错误使用await），如果想要多个Promise同时运行请开启canRunMultiPromiseAtOneTime
    // 2. 所有的Async以及Promise只能用于一个System内，夸System的订阅请使用Event
    // 3. cancelAsync会停止正在运行的Promise链，使得Promise无法往后执行
    // 4. rejectAsync 停止当前执行的Promise链（原理：Promise.reject），并跳出当前运行堆栈，类似抛异常机制，如果有意而为之，那么需要在Async订阅函数那里进行catch，否则会认为是报错
    // 5. newPromise底层实现使用了订阅器，所以参数以及运行原理和订阅器一样
    // 6. unsubscribeAll默认会清理所有Async，system uninit后也会进行统一清理
    // 7. cancel和reject的区别：reject相当于带清理的throw，外面如果不catch会当成异常处理，reject完立马会跳出调用栈；cancel不会跳出，只是当前promise不在resolve
    // 8. result = await newPromise(xxx, callback) ，result和callback并不是一个时间点，callback是收到订阅后立即触发的，result则是resolve完，出了整个调用栈，靠原生promise call回来才有的，所以两者并不是等价的
    // 9. 有的callback可选，有的必须填（比如action，delegate）原因是必须填的那些Promise从定义上来讲就是需要立即执行的，尤其是需要返回值的，可选的可以进行延迟处理
    // 10. 如果需要等待多个promise结果，请使用multiPromise

    /**
     * 创建Promise执行链，一个Async内可以newPromise，只能串行执行，不能起多个newPromise，如果需要起多个Asyn那么请用startAsyncGroup进行组合
     * @param callback 要运行的Async函数
     * @param thisArg System
     * @param args 函数参数数组
     * @param canRunMultiPromiseAtOneTime 是否允许同时有多个Promise在运行
     * @param resolveCallback 执行完回调函数，只有正常执行会触发，cancel以及reject不会触发
     * @param description 描述
     * @returns Handle
     */
    public startAsync<TReturnValue, TCallback extends (asyncHandle: symbol, ...args: any[]) => Promise<TReturnValue>>(
        inCallback: TCallback,
        thisArg?: System,
        args?: [...AsyncParametersWithoutHandle<TCallback>],
        canRunMultiPromiseAtOneTime?: boolean,
        resolveCallback?: (() => void) | ((value: TReturnValue) => void),
        rejectCallback?: (reason?: any) => void,
        finallyCallback?: (asyncHandle: symbol, result?: any, rejectReason?: any) => void,
        description?: string,
    ): symbol | undefined;

    public startAsync(params: IStartAsyncParams): symbol | undefined;

    public startAsync(...args: any[]): symbol | undefined {
        if (args.length === 1 && typeof args[0] !== "function") {
            return getManager().getSystemSubscribeHelper(this).startAsync(args[0]);
        } else {
            let [inCallback, thisArg, inArgs, canRunMultiPromiseAtOneTime, resolveCallback, rejectCallback, finallyCallback, description] = args;
            let callback = inArgs ? (asyncHandle: symbol) => inCallback.call(thisArg, asyncHandle, ...inArgs) : inCallback;

            return getManager().getSystemSubscribeHelper(this).startAsync({
                callback,
                thisArg,
                canRunMultiPromiseAtOneTime,
                resolveCallback: resolveCallback,
                rejectCallback,
                finallyCallback,
                description,
            });
        }
    }

    public hasAnyAsync() {
        return getManager().getSystemSubscribeHelper(this).hasAnyAsync();
    }

    // /**
    //  * 将一组Async进行打包，监听所有Async执行结果
    //  * @param operator 异步请求操作类型
    //  * @param handles Async Handle
    //  * @param finishCallback 执行回调，只有正常执行才会触发
    //  * @param thisArg System
    //  * @param description 描述
    //  * @returns Handle
    //  */
    // public startAsyncGroup(
    //     operator: EAsyncGroupOperator,
    //     handles: symbol | symbol[],
    //     finishCallback?: () => void,
    //     thisArg?: System,
    //     description?: string,
    // ): symbol {
    //     return getManager()
    //         .getSystemSubscribeHelper(this)
    //         .startAsyncGroup(operator, handles, finishCallback, thisArg, description);
    // }

    /**
     * 取消Promise执行链
     * @param asyncHandle Handle
     */
    public cancelAsync(asyncHandle: symbol) {
        return getManager().getSystemSubscribeHelper(this).cancelAsync(asyncHandle);
    }

    /**
     * 取消Promise执行链，并跳出当前堆栈，抛出reason异常，必须在async函数中执行
     * @param asyncHandle Handle
     * @param reason 原因
     */
    public rejectAsync(asyncHandle: symbol, reason?: unknown) {
        return getManager().getSystemSubscribeHelper(this).rejectAsync(asyncHandle, reason);
    }

    /**
     * 取消所有promise
     */
    public cancelAllAsync() {
        return getManager().getSystemSubscribeHelper(this).cancelAllAsync();
    }

    /**
     * 创建单个Promise，必须在startAsync后以及async函数中执行
     * @param asyncHandle Handle
     * @param args 参数同订阅器
     * @returns Promise
     */
    public newPromise(asyncHandle: symbol, ...args: any[]): Promise<unknown> {
        return getManager()
            .getSystemSubscribeHelper(this)
            .newPromise(asyncHandle, ...args);
    }

    /**
     * 等待多个Promise执行结果
     * @param asyncHandle Handle
     * @param promises Promises
     * @param operator 类型
     */
    // public multiPromise(asyncHandle: symbol, promises: Array<Promise<unknown>>, operator: EMultiPromiseOperator): Promise<unknown> {
    //     return getManager().getSystemSubscribeHelper(this).multiPromise(asyncHandle, promises, operator);
    // }

    // //////////////////////////////////////////////////////////////////
    // 权限
    /**
     * 修改Store（允许打断，若 func 返回 false 则不会触发 StoreChangeSEvent)
     * @param store 实例
     * @param func 修改函数
     */
    protected modifyWithAbort<T extends Store>(store: Readonly<T>, func: (store: T) => boolean) {
        assert(getManager().isStoreOwnedBySystem(store.constructor as StoreConstructor, this.constructor as SystemConstructor), `there is no permission to modify this store`);

        HookUtil.triggerHook(HookType.onStorePreModify, store);
        let ret = func.call(this, store as unknown as T);
        HookUtil.triggerHook(HookType.onStorePostModify, store, ret);

        if (ret === undefined || ret === true) {
            RuntimeContext.get().addDirtyStore(store as any);
        }
    }

    /**
     * 修改Store（触发StoreChanged）
     * @param store 实例
     * @param func 修改函数
     */
    protected modify<T extends Store>(store: Readonly<T>, func: (store: T) => void) {
        this.modifyWithAbort(store, (store) => {
            func.call(this, store);
            return true;
        });
    }

    /**
     * 修改Store（不触发StoreChanged）
     * @param store 实例
     * @param func 修改函数
     */
    protected modifyWithoutNotify<T extends Store>(store: Readonly<T>, func: (store: T) => void) {
        this.modifyWithAbort(store, (store) => {
            func.call(this, store);
            return false;
        });
    }

    // //////////////////////////////////////////////////////////////////
    // log相关，未来log这块可以接类似log4j的库
    protected assert(condition: any, message?: string): asserts condition {
        assert(condition, `[${this.constructor.name}] ${message ?? ""}`);
    }

    protected debug(...args: any[]) {
        console.debug(`[${this.constructor.name}]`, ...args);
    }

    protected info(...args: any[]) {
        console.log(`[${this.constructor.name}]`, ...args);
    }

    protected warn(...args: any[]) {
        console.warn(`[${this.constructor.name}]`, ...args);
    }

    protected error(...args: any[]) {
        console.error(`[${this.constructor.name}]`, ...args);
    }
}
