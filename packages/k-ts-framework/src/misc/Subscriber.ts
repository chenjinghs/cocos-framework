/* eslint-disable @typescript-eslint/member-ordering */
import { Env } from "../framework/Env.js";
import { Constructor, IEnvData, IStartAsyncExtraOutput, IStartAsyncParams, ISubscribeHelper, ISystem, ResolveFuncType } from "../framework/Interface.js";
import { assert, getStackTraceInfo, getStackTraceInfoString, IStackTraceInfo } from "../global/GlobalFunctions.js";
import { AsyncInfo, cancelAllAsyncInfos, cancelAsyncInfo, createAsyncInfo, createPromiseInfo } from "./AsyncInfo.js";

/**
 * 订阅实例的信息
 */
export class SubscribeInstanceInfo {
    public constructor(public subscriber: ISubscriber, public args: any[], public resolve: ResolveFuncType | undefined, public subscribeResult?: unknown) {}
}

/**
 * 订阅器接口
 */
export interface ISubscriber {
    canProcess: (...args: any[]) => boolean;
    equal: (sourceArgs: any[], targetArgs: any[]) => boolean;
    subscribe: (info: SubscribeInstanceInfo, ...args: any[]) => unknown;
    unsubscribe: (info: SubscribeInstanceInfo, ...args: any[]) => boolean;
    getInfo: (info: SubscribeInstanceInfo | undefined, ...args: any[]) => string;
}

/**
 * 订阅器注册信息
 */
export class SubscriberRegistry implements IEnvData {
    public subscribers = new Map<Constructor<ISubscriber>, ISubscriber>();

    public register(ctor: Constructor<ISubscriber>): ISubscriber {
        assert(!this.subscribers.has(ctor), `duplicated subscriber type ${ctor.name}`);

        let ret = new ctor();
        this.subscribers.set(ctor, ret);
        return ret;
    }

    public unregister(ctor: Constructor<ISubscriber>) {
        this.subscribers.delete(ctor);
    }

    public find<T extends ISubscriber>(ctor: Constructor<T>) {
        return this.subscribers.get(ctor) as T;
    }

    public get<T extends ISubscriber>(ctor: Constructor<T>) {
        let ret = this.subscribers.get(ctor);
        assert(ret, `can not get subscriber from registry ${ctor.name}`);
        return ret as T;
    }

    public inheritFrom(source: SubscriberRegistry) {
        source.subscribers.forEach((v, k) => {
            if (!this.subscribers.has(k)) {
                this.register(k);
            }
        });
    }
}

// ///////////////////////////////////////////////////////////////////////////
// export const EMPTY_CALLBACK_RETURN_VALUE = Symbol("EmptyCallbackReturnValue");
export const EMPTY_CALLBACK = function (..._args: any[]): void {};

export class SubscribeHelper implements ISubscribeHelper {
    private infos = new Map<number | symbol, SubscribeInstanceInfo>();
    private maxHandle = 0;
    public asyncInfos?: Map<symbol, AsyncInfo>;

    public subscribe(...args: any[]): number {
        return this.subscribeWithHandleImp(undefined, ++this.maxHandle, ...args) as number;
    }

    public unsubscribe(...args: any[]): boolean {
        if (!this.infos) return false;

        let target = this.getSubscriber(...args);
        for (let [k, v] of this.infos) {
            if (target === v.subscriber && target.equal(v.args, args)) {
                target.unsubscribe(v, ...v.args);
                this.infos.delete(k);
                return true;
            }
        }

        assert(false, `unsubscribe failed, can not find target with args, info: ${target.getInfo(undefined, ...args)}`);
    }

    public subscribeWithHandle(handle: symbol, ...args: any[]): symbol {
        return this.subscribeWithHandleImp(undefined, handle, ...args) as symbol;
    }

    public unsubscribeWithHandle(handle: symbol | number): boolean {
        let info = this.infos.get(handle as any);
        if (info === undefined) {
            // console.warn(`unsubscribeWithHandle failed, handle ${handle} not found`);
            return false;
        }

        info.subscriber.unsubscribe(info, ...info.args);
        this.infos.delete(handle);
        return true;
    }

    public unsubscribeAll(includeAsync = true) {
        for (let [_, v] of this.infos) {
            v.subscriber.unsubscribe(v, ...v.args);
        }
        this.infos.clear();

        if (includeAsync && this.asyncInfos) {
            this.cancelAllAsync();
            this.asyncInfos = undefined;
        }
    }

    public printInfo() {
        for (let [_, v] of this.infos) {
            console.log(v.subscriber.getInfo(v, ...v.args));
        }
    }

    public hasSubscribed(handle: symbol | number): boolean {
        return this.infos.has(handle);
    }

    private subscribeWithHandleImp(resolve: ((value: unknown) => void) | undefined, handle: number | symbol, ...args: any[]) {
        assert(!this.infos.has(handle), `subscribeWithHandle failed, duplicated handle ${handle.toString()}`);

        let target = this.getSubscriber(...args);
        let info = new SubscribeInstanceInfo(target, args, resolve);
        info.subscribeResult = target.subscribe(info, ...args);
        this.infos.set(handle, info);
        return handle;
    }

    private getSubscriber(...args: any[]) {
        let subscribers = Env.current.getData(SubscriberRegistry).subscribers;

        for (let [_, v] of subscribers) {
            if (v.canProcess(...args)) {
                return v;
            }
        }
        assert(false, `can not find subscriber`);
    }

    // //////////////////////////////////////////////////////////////////
    // 异步相关
    public startAsync(params: IStartAsyncParams, output?: IStartAsyncExtraOutput): symbol | undefined {
        if (!this.asyncInfos) this.asyncInfos = new Map();
        return createAsyncInfo(this, params, output);
    }

    public cancelAsync(asyncHandle: symbol) {
        cancelAsyncInfo(this, asyncHandle);
    }

    public cancelAllAsync() {
        cancelAllAsyncInfos(this);
    }

    public newPromise(asyncHandle: symbol, ...args: any[]): Promise<any> {
        let ret = createPromiseInfo(this, asyncHandle);
        this.subscribeWithHandleImp(ret.resolve, ret.handle, ...args);
        return ret.promise;
    }

    public rejectAsync(asyncHandle: symbol, reason?: unknown) {
        this.cancelAsync(asyncHandle);
        return Promise.reject(reason);
    }

    public hasAnyAsync() {
        return this.asyncInfos !== undefined && this.asyncInfos.size > 0;
    }
}

// ///////////////////////////////////////////////////////////////////////////
export function checkArgsEqual(sourceArgs: any[], targetArgs: any[], argsCount: number, optionArgsCount?: number) {
    let checkedArgsCount = argsCount;
    if (optionArgsCount !== undefined) {
        if (sourceArgs.length >= optionArgsCount || targetArgs.length >= optionArgsCount) checkedArgsCount = optionArgsCount;
    }

    if (sourceArgs.length < checkedArgsCount || targetArgs.length < checkedArgsCount) return false;

    for (let i = 0; i < checkedArgsCount; ++i) {
        if (sourceArgs[i] !== targetArgs[i]) return false;
    }
    return true;
}

// ///////////////////////////////////////////////////////////////////////////
type CallbackType = (...args: any[]) => any;

class CallbackInfo {
    public constructor(public callback: CallbackType, public thisArg?: ISystem, public isValid = true, public debugInfo?: IStackTraceInfo) {}
}

class Request {
    public constructor(public key: any, public info: CallbackInfo | null) {}
}

export class SubscriberWithKey {
    private infos = new Map<any, Array<CallbackInfo> | CallbackInfo>(); // 多个注册者才会用Array
    private dispatchingCount = 0;
    private requests: Array<Request> | undefined = undefined;
    private onlyOneReceiver = false;

    public constructor(onlyOneReceiver: boolean) {
        this.onlyOneReceiver = onlyOneReceiver;
    }

    public subscribe(key: any, callback: CallbackType, thisArg?: ISystem, debugInfo?: string) {
        let newInfo = new CallbackInfo(callback, thisArg, true, debugInfo || getStackTraceInfo());
        this.subscribeImp(key, newInfo);
    }

    public unsubscribe(key: any, callback: CallbackType, thisArg?: ISystem) {
        let info = this.infos.get(key);
        if (!info) {
            return;
        }

        if (info.constructor === CallbackInfo) {
            let singleData = info as CallbackInfo;
            if (singleData.callback === callback && singleData.thisArg === thisArg) {
                singleData.isValid = false;
                if (this.isDispatching()) {
                    this.pushRequests(key, singleData);
                } else {
                    this.infos.delete(key);
                }
            }
        } else {
            let multiData = info as CallbackInfo[];
            let count = multiData.length;
            let singleData: CallbackInfo;
            for (let i = 0; i < count; ++i) {
                singleData = multiData[i];
                if (singleData.callback === callback && singleData.thisArg === thisArg) {
                    if (singleData.isValid) {
                        singleData.isValid = false;
                        if (this.isDispatching()) {
                            this.pushRequests(key, singleData);
                        } else {
                            multiData.splice(i, 1);
                        }
                    }
                    if (multiData.length === 0) {
                        this.infos.delete(key);
                    }
                    break;
                }
            }
        }
    }

    public dispatch(key: any, ...args: any[]): any {
        let result;
        let info = this.infos.get(key);
        if (info) {
            if (info.constructor === CallbackInfo) {
                result = this.tryCall(info as CallbackInfo, ...args);
            } else {
                let multiData = info as CallbackInfo[];
                // 这里有可能在dispatch时subscribe增加multiData，unsubscribe只会打标记，dispatch后才会真正删除
                // eslint-disable-next-line @typescript-eslint/prefer-for-of
                let count = multiData.length;
                for (let i = 0; i < count; ++i) {
                    result = this.tryCall(multiData[i], ...args) ?? result;
                }
                // for(let v of multiData) {
                //     this.tryCall(v, ...args)
                // }
            }
        }

        if (!this.isDispatching()) {
            if (this.requests) {
                for (let v of this.requests) {
                    if (v.info) {
                        if (v.info.isValid) {
                            this.subscribeImp(v.key, v.info);
                        } else {
                            this.unsubscribe(v.key, v.info.callback, v.info.thisArg);
                        }
                    } else {
                        this.unsubscribeKey(v.key);
                    }
                }
                this.requests = undefined;
            }
        }
        return result;
    }

    public unsubscribeKey(key: any) {
        if (this.isDispatching()) {
            let info = this.infos.get(key);
            if (info) {
                this.pushRequests(key, null);
            }
        } else {
            this.infos.delete(key);
        }
    }

    public printInfo() {
        this.infos.forEach((info, key) => {
            console.log(`name [${key.constructor.name}]: \r\n`);
            if (info.constructor === CallbackInfo) {
                console.log(`\tinfo: ${this.verifyDebugInfo(info as CallbackInfo)}\r\n`);
            } else {
                let multiData = info as CallbackInfo[];
                for (let v of multiData) {
                    console.log(`\tinfo: ${this.verifyDebugInfo(v)}\r\n`);
                }
            }
        });
    }

    public findDebugInfo(key: any) {
        let infos = this.infos.get(key);
        if (!infos) return;

        if (Array.isArray(infos)) {
            for (const v of infos) if (v.isValid) return this.verifyDebugInfo(v);
        } else if (infos.isValid) {
            return this.verifyDebugInfo(infos);
        }
        return;
    }

    public hasSubscriber(key: any): boolean {
        let infos = this.infos.get(key);
        if (!infos) return false;

        if (Array.isArray(infos)) return infos.some((v) => v.isValid);
        return infos.isValid;
    }

    private subscribeImp(key: any, newInfo: CallbackInfo) {
        let info = this.infos.get(key);
        let isSingleInfo = false;

        if (info) {
            isSingleInfo = info.constructor === CallbackInfo;
            if (this.onlyOneReceiver) {
                if (isSingleInfo) {
                    assert(!(info as CallbackInfo).isValid, `${key.name} must have only one subscriber`);
                } else {
                    let infoArray = info as CallbackInfo[];
                    for (let v of infoArray) {
                        assert(!v.isValid, `${key.name} must have only one subscriber`);
                    }
                }
            } else {
                if (isSingleInfo) {
                    // assert(!(info as CallbackInfo).isValid);
                } else {
                    let infoArray = info as CallbackInfo[];
                    for (let v of infoArray) {
                        if (v.callback === newInfo.callback && v.thisArg === newInfo.thisArg) {
                            assert(!v.isValid);
                            break;
                        }
                    }
                }
            }
        }

        // if(this.isDispatching()) {
        //     this.pushRequests(key, newInfo)
        // } else {
        if (!info) {
            this.infos.set(key, newInfo);
        } else if (isSingleInfo) {
            // 单个元素转成数组
            let newCallbacks = [info as CallbackInfo, newInfo];
            this.infos.set(key, newCallbacks);
        } else {
            (info as CallbackInfo[]).push(newInfo);
        }
        // }
    }

    private tryCall(callbackInfo: CallbackInfo, ...args: any[]): any {
        if (!callbackInfo.isValid) {
            return;
        }

        // assert(callbackInfo.thisArg, `dispatch failed, system is invalid, info: ${callbackInfo.debugInfo}`);

        ++this.dispatchingCount;
        let ret = callbackInfo.callback.call(callbackInfo.thisArg, ...args);
        --this.dispatchingCount;
        assert(this.dispatchingCount >= 0);
        return ret;
    }

    private isDispatching(): boolean {
        return this.dispatchingCount > 0;
    }

    private pushRequests(key: any, info: CallbackInfo | null) {
        if (!this.requests) {
            this.requests = [];
        }
        this.requests.push(new Request(key, info));
    }

    private verifyDebugInfo(info: CallbackInfo) {
        return getStackTraceInfoString(info.debugInfo) || `${info.callback}`;
    }
}
