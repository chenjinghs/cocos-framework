/* eslint-disable @typescript-eslint/method-signature-style */
/* eslint-disable @typescript-eslint/member-ordering */
import { Action, ActionInnerUtil, StoreAction, StoreActionInnerUtil } from "../framework/Action.js";
import { Env } from "../framework/Env.js";
import { Event, EventInnerUtil, StoreEvent, StoreEventInnerUtil } from "../framework/Event.js";
import { CallbackType, Constructor, IEnvData } from "../framework/Interface.js";
import { Store } from "../framework/Store.js";
import { System } from "../framework/System.js";
import { assert, getStackTraceInfo, isChildOf, IStackTraceInfo } from "../global/GlobalFunctions.js";
import { HookUtil } from "./HookDefine.js";
import { StoreKeyHelper } from "./StoreKeyHelper.js";
import { SubscribeHook } from "./SubscribeHook.js";
import { checkArgsEqual, ISubscriber, SubscribeInstanceInfo, SubscriberRegistry, SubscriberWithKey } from "./Subscriber.js";

export function verifySubscriberCallback(
    info: SubscribeInstanceInfo,
    callback: CallbackType | undefined,
    thisArg: any,
    resolveValueFunc: (callbackResult: any, ...args: any[]) => any,
    description?: string,
) {
    let newCallback = HookUtil.get(SubscribeHook).hookSubscriberCallback(info, callback, thisArg, description) ?? callback;

    if (info.resolve) {
        let resolve = info.resolve;
        return function (...args: any[]) {
            let ret = newCallback ? newCallback.call(thisArg, ...args) : undefined;
            resolve(resolveValueFunc(ret, ...args));
            return ret;
        };
    } else {
        assert(newCallback, `subscribe failed, callback is invalid, description: ${description}`);
        return newCallback;
    }
}

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// Action
declare module "../framework/System.js" {
    export interface System {
        /**
         * 订阅 Action
         * @param actionCtor Action类型
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        subscribe<TReturnType, T extends Action<TReturnType>>(actionCtor: Constructor<T>, callback: (action: T) => TReturnType, thisArg?: System, description?: string): number;

        /**
         * 订阅 Action，并指定 Handle
         * @param handle: 外部指定的Handle，不能为空
         * @param actionCtor Action类型
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         */
        subscribeWithHandle<TReturnType, T extends Action<TReturnType>>(handle: symbol, actionCtor: Constructor<T>, callback: (action: T) => TReturnType, thisArg?: System, description?: string): void;

        /**
         * 取消订阅 Action，参数需要和订阅时一致
         * @param actionCtor Action类型
         * @param callback 处理函数，因为需要立即执行并有可能有返回值，所以callback必填
         * @param thisArg System实例
         * @returns 取消订阅是否成功
         */
        unsubscribe<TReturnType, T extends Action<TReturnType>>(actionCtor: Constructor<T>, callback: (action: T) => TReturnType, thisArg?: System): boolean;

        /**
         * 创建 Action Promise，因为需要立即执行，所以必须有callback处理
         * @param actionCtor Action类型
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns Action
         */
        newPromise<TReturnType, T extends Action<TReturnType>>(
            asyncHandle: symbol,
            actionCtor: Constructor<T>,
            callback: (action: T) => TReturnType,
            thisArg?: System,
            description?: string,
        ): Promise<T>;
    }
}

export class ActionSubscriber implements ISubscriber {
    private worker = new SubscriberWithKey(true);

    public static hasSubscribed(ctor: Constructor) {
        return Env.getCurrentData(SubscriberRegistry).get(ActionSubscriber).worker.hasSubscriber(ctor);
    }

    public static dispatch(action: Action<unknown>) {
        return Env.getCurrentData(SubscriberRegistry).get(ActionSubscriber).worker.dispatch(action.constructor, action);
    }

    public canProcess<TReturnType, T extends Action<TReturnType>>(actionCtor: Constructor<T>): boolean {
        return typeof actionCtor === "function" && isChildOf(actionCtor, Action);
    }

    public equal(sourceArgs: any[], targetArgs: any[]): boolean {
        // actionCtor, callback, thisArgs(option)
        return checkArgsEqual(sourceArgs, targetArgs, 2, 3);
    }

    public subscribe<TReturnType, T extends Action<TReturnType>>(
        info: SubscribeInstanceInfo,
        actionCtor: Constructor<T>,
        callback?: (action: T) => TReturnType,
        thisArg?: System,
        description?: string,
    ) {
        assert(info.resolve || callback, `subscribe action failed, callback is invalid`);

        let newCallback = verifySubscriberCallback(info, callback, thisArg, ActionSubscriber.resolveValueFunc, description);
        this.worker.subscribe(actionCtor, newCallback, thisArg, description);
        return newCallback;
    }

    public unsubscribe<TReturnType, T extends Action<TReturnType>>(info: SubscribeInstanceInfo, actionCtor: Constructor<T>, _callback?: (action: T) => TReturnType, thisArg?: System): boolean {
        this.worker.unsubscribe(actionCtor, info.subscribeResult as CallbackType, thisArg);
        return true;
    }

    public getInfo<TReturnType, T extends Action<TReturnType>>(
        _info: SubscribeInstanceInfo | undefined,
        actionCtor: Constructor<T>,
        callback?: (action: T) => TReturnType,
        thisArg?: System,
        description?: string,
    ): string {
        return `action ${actionCtor.name}, system ${thisArg?.constructor.name}, description: ${description || this.worker.findDebugInfo(actionCtor)}, callback: ${callback}`;
    }

    private static resolveValueFunc(_callbackResult: any, action: Action<unknown>) {
        return action;
    }
}

HookUtil.get(SubscribeHook).registerSubscriber(ActionSubscriber);
ActionInnerUtil.hasSubscribed = ActionSubscriber.hasSubscribed;
ActionInnerUtil.dispatch = ActionSubscriber.dispatch;

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// StoreAction
declare module "../framework/System.js" {
    export interface System {
        /**
         * 订阅 StoreAction
         * @param storeCtor Store类型
         * @param storeActionCtor StoreAction类型
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        subscribe<TReturnType, TS extends Store, TA extends StoreAction<TReturnType>>(
            storeCtor: Constructor<TS>,
            storeActionCtor: Constructor<TA>,
            callback: (action: TA) => TReturnType,
            thisArg?: System,
            description?: string,
        ): number;

        /**
         * 订阅 StoreAction，并指定 Handle
         * @param handle: 外部指定的Handle，不能为空
         * @param storeCtor Store类型
         * @param storeActionCtor StoreAction类型
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         */
        subscribeWithHandle<TReturnType, TS extends Store, TA extends StoreAction<TReturnType>>(
            handle: symbol,
            storeCtor: Constructor<TS>,
            storeActionCtor: Constructor<TA>,
            callback: (action: TA) => TReturnType,
            thisArg?: System,
            description?: string,
        ): void;

        /**
         * 取消订阅 StoreAction，参数需要和订阅时一致
         * @param storeCtor Store类型
         * @param storeActionCtor StoreAction类型
         * @param callback 处理函数，因为需要立即执行并有可能有返回值，所以callback必填
         * @param thisArg System实例
         * @returns 取消订阅是否成功
         */
        unsubscribe<TReturnType, TS extends Store, TA extends StoreAction<TReturnType>>(
            storeCtor: Constructor<TS>,
            storeActionCtor: Constructor<TA>,
            callback: (action: TA) => TReturnType,
            thisArg?: System,
        ): boolean;

        /**
         * 创建 StoreAction Promise
         * @param storeCtor Store类型
         * @param storeActionCtor StoreAction类型
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns StoreAction
         */
        newPromise<TReturnType, TS extends Store, TA extends StoreAction<TReturnType>>(
            asyncHandle: symbol,
            storeCtor: Constructor<TS>,
            storeActionCtor: Constructor<TA>,
            callback: (action: TA) => TReturnType,
            thisArg?: System,
            description?: string,
        ): Promise<TA>;
    }
}

export class StoreActionSubscriber implements ISubscriber {
    private worker = new SubscriberWithKey(false);

    public static findKey(storeCtor: Constructor, actionCtor: Constructor): number | undefined {
        return StoreKeyHelper.getKey(storeCtor, actionCtor, false);
    }

    public static do(key: number, action: StoreAction<unknown>) {
        return Env.getCurrentData(SubscriberRegistry).get(StoreActionSubscriber).worker.dispatch(key, action);
    }

    public canProcess<TReturnType, TS extends Store, TA extends StoreAction<TReturnType>>(storeCtor: Constructor<TS>, storeActionCtor: Constructor<TA>): boolean {
        return typeof storeCtor === "function" && typeof storeActionCtor === "function" && isChildOf(storeCtor, Store) && isChildOf(storeActionCtor, StoreAction);
    }

    public equal(sourceArgs: any[], targetArgs: any[]): boolean {
        // storeCtor, storeActionCtor, callback, thisArgs(option)
        return checkArgsEqual(sourceArgs, targetArgs, 3, 4);
    }

    public subscribe<TReturnType, TS extends Store, TA extends StoreAction<TReturnType>>(
        info: SubscribeInstanceInfo,
        storeCtor: Constructor<TS>,
        storeActionCtor: Constructor<TA>,
        callback?: (action: TA) => TReturnType,
        thisArg?: System,
        description?: string,
    ) {
        assert(info.resolve || callback, `subscribe store action failed, callback is invalid`);

        let newCallback = verifySubscriberCallback(info, callback, thisArg, StoreActionSubscriber.resolveValueFunc, description);

        let key = StoreKeyHelper.getKey(storeCtor, storeActionCtor, true)!;
        this.worker.subscribe(key, newCallback, thisArg, description);
        return [key, newCallback];
    }

    public unsubscribe<TReturnType, TS extends Store, TA extends StoreAction<TReturnType>>(
        info: SubscribeInstanceInfo,
        storeCtor: Constructor<TS>,
        storeActionCtor: Constructor<TA>,
        _callback?: (action: TA) => TReturnType,
        thisArg?: System,
    ): boolean {
        let [key, savedCallback] = info.subscribeResult as [number, CallbackType];
        assert(key === StoreKeyHelper.getKey(storeCtor, storeActionCtor, false));

        this.worker.unsubscribe(key, savedCallback, thisArg);
        return true;
    }

    public getInfo<TReturnType, TS extends Store, TA extends StoreAction<TReturnType>>(
        info: SubscribeInstanceInfo | undefined,
        storeCtor: Constructor<TS>,
        storeActionCtor: Constructor<TA>,
        callback?: (action: TA) => TReturnType,
        thisArg?: System,
        description?: string,
    ): string {
        let [key, _savedCallback] = info?.subscribeResult as [number, CallbackType];
        return `store ${storeCtor.name}, action ${storeActionCtor.name}, system ${thisArg?.constructor.name}, description: ${description || this.worker.findDebugInfo(key)}, callback: ${callback}`;
    }

    private static resolveValueFunc(_callbackResult: any, action: StoreAction<unknown>) {
        return action;
    }
}

HookUtil.get(SubscribeHook).registerSubscriber(StoreActionSubscriber);
StoreActionInnerUtil.findKey = StoreActionSubscriber.findKey;
StoreActionInnerUtil.do = StoreActionSubscriber.do;

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// Event
declare module "../framework/System.js" {
    export interface System {
        /**
         * 订阅 Event
         * @param eventCtor Event类型
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        subscribe<T extends Event>(eventCtor: Constructor<T>, callback: (event: T) => void, thisArg?: System, description?: string): number;

        /**
         * 订阅 Event，并指定 Handle
         * @param handle: 外部指定的Handle，不能为空
         * @param eventCtor Event类型
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         */
        subscribeWithHandle<T extends Event>(handle: symbol, eventCtor: Constructor<T>, callback: (event: T) => void, thisArg?: System, description?: string): void;

        /**
         * 取消订阅 Event，参数需要和订阅时一致
         * @param eventCtor Event类型
         * @param callback 处理函数
         * @param thisArg System实例
         * @returns 取消订阅是否成功
         */
        unsubscribe<T extends Event>(eventCtor: Constructor<T>, callback: (event: T) => void, thisArg?: System): boolean;

        /**
         * 创建 Event Promise
         * @param eventCtor Event类型
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns Promise
         */
        newPromise<T extends Event>(asyncHandle: symbol, eventCtor: Constructor<T>, callback?: (event: T) => void, thisArg?: System, description?: string): Promise<T>;
    }
}

export class EventSubscriber implements ISubscriber {
    private worker = new SubscriberWithKey(false);

    public static dispatch(event: Event) {
        return Env.getCurrentData(SubscriberRegistry).get(EventSubscriber).worker.dispatch(event.constructor, event);
    }

    public canProcess<T extends Event>(eventCtor: Constructor<T>): boolean {
        return typeof eventCtor === "function" && isChildOf(eventCtor, Event);
    }

    public equal(sourceArgs: any[], targetArgs: any[]): boolean {
        // eventCtor, callback, thisArgs(option)
        return checkArgsEqual(sourceArgs, targetArgs, 2, 3);
    }

    public subscribe<T extends Event>(info: SubscribeInstanceInfo, eventCtor: Constructor<T>, callback?: (event: T) => void, thisArg?: System, description?: string) {
        assert(info.resolve || callback, `subscribe event failed, callback is invalid`);

        let newCallback = verifySubscriberCallback(info, callback, thisArg, EventSubscriber.resolveValueFunc, description);

        this.worker.subscribe(eventCtor, newCallback, thisArg, description);
        return newCallback;
    }

    public unsubscribe<T extends Event>(info: SubscribeInstanceInfo, eventCtor: Constructor<T>, _callback?: (event: T) => void, thisArg?: System): boolean {
        this.worker.unsubscribe(eventCtor, info.subscribeResult as CallbackType, thisArg);
        return true;
    }

    public getInfo<T extends Event>(_info: SubscribeInstanceInfo | undefined, eventCtor: Constructor<T>, callback: (event: T) => void, thisArg?: System, description?: string): string {
        return `event ${eventCtor.name}, system ${thisArg?.constructor.name}, description: ${description || this.worker.findDebugInfo(eventCtor)}, callback: ${callback}`;
    }

    private static resolveValueFunc(_callbackResult: any, event: Event) {
        return event;
    }
}

HookUtil.get(SubscribeHook).registerSubscriber(EventSubscriber);
EventInnerUtil.dispatch = EventSubscriber.dispatch;

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// StoreEvent
declare module "../framework/System.js" {
    export interface System {
        /**
         * 订阅 StoreEvent
         * @param storeCtor Store类型
         * @param storeEventCtor StoreEvent类型
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        subscribe<TS extends Store, TE extends StoreEvent>(storeCtor: Constructor<TS>, storeEventCtor: Constructor<TE>, callback: (event: TE) => void, thisArg?: System, description?: string): number;

        /**
         * 订阅 StoreEvent，并指定 Handle
         * @param handle: 外部指定的Handle，不能为空
         * @param storeCtor Store类型
         * @param storeEventCtor StoreEvent类型
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         */
        subscribeWithHandle<TS extends Store, TE extends StoreEvent>(
            handle: symbol,
            storeCtor: Constructor<TS>,
            storeEventCtor: Constructor<TE>,
            callback: (event: TE) => void,
            thisArg?: System,
            description?: string,
        ): void;

        /**
         * 取消订阅 StoreEvent，参数需要和订阅时一致
         * @param storeCtor Store类型
         * @param storeEventCtor StoreEvent类型
         * @param callback 处理函数
         * @param thisArg System实例
         * @returns 取消订阅是否成功
         */
        unsubscribe<TS extends Store, TE extends StoreEvent>(storeCtor: Constructor<TS>, storeEventCtor: Constructor<TE>, callback: (event: TE) => void, thisArg?: System): boolean;

        /**
         * 创建 StoreEvent Promise
         * @param storeCtor Store类型
         * @param storeEventCtor StoreEvent类型
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns Promise
         */
        newPromise<TS extends Store, TE extends StoreEvent>(
            asyncHandle: symbol,
            storeCtor: Constructor<TS>,
            storeEventCtor: Constructor<TE>,
            callback?: (event: TE) => void,
            thisArg?: System,
            description?: string,
        ): Promise<TE>;
    }
}

export class StoreEventSubscriber implements ISubscriber {
    private worker = new SubscriberWithKey(false);

    public static findKey(storeCtor: Constructor, eventCtor: Constructor): number | undefined {
        return StoreKeyHelper.getKey(storeCtor, eventCtor, false);
    }

    public static dispatch(key: number, event: StoreEvent) {
        return Env.getCurrentData(SubscriberRegistry).get(StoreEventSubscriber).worker.dispatch(key, event);
    }

    public canProcess<TS extends Store, TE extends StoreEvent>(storeCtor: Constructor<TS>, storeEventCtor: Constructor<TE>): boolean {
        return typeof storeCtor === "function" && typeof storeEventCtor === "function" && isChildOf(storeCtor, Store) && isChildOf(storeEventCtor, StoreEvent);
    }

    public equal(sourceArgs: any[], targetArgs: any[]): boolean {
        // storeCtor, storeEventCtor, callback, thisArgs(option)
        return checkArgsEqual(sourceArgs, targetArgs, 3, 4);
    }

    public subscribe<TS extends Store, TE extends StoreEvent>(
        info: SubscribeInstanceInfo,
        storeCtor: Constructor<TS>,
        storeEventCtor: Constructor<TE>,
        callback?: (event: TE) => void,
        thisArg?: System,
        description?: string,
    ) {
        assert(info.resolve || callback, `subscribe store event failed, callback is invalid`);

        let newCallback = verifySubscriberCallback(info, callback, thisArg, StoreEventSubscriber.resolveValueFunc, description);

        let key = StoreKeyHelper.getKey(storeCtor, storeEventCtor, true)!;
        this.worker.subscribe(key, newCallback, thisArg, description);
        return [key, newCallback];
    }

    public unsubscribe<TS extends Store, TE extends StoreEvent>(
        info: SubscribeInstanceInfo,
        storeCtor: Constructor<TS>,
        storeEventCtor: Constructor<TE>,
        _callback?: (event: TE) => void,
        thisArg?: System,
    ): boolean {
        let [key, savedCallback] = info.subscribeResult as [number, CallbackType];
        assert(key === StoreKeyHelper.getKey(storeCtor, storeEventCtor, false));

        this.worker.unsubscribe(key, savedCallback, thisArg);
        return true;
    }

    public getInfo<TS extends Store, TE extends StoreEvent>(
        info: SubscribeInstanceInfo | undefined,
        storeCtor: Constructor<TS>,
        storeEventCtor: Constructor<TE>,
        callback: (event: TE) => void,
        thisArg?: System,
        description?: string,
    ): string {
        let [key, _savedCallback] = info?.subscribeResult as [number, CallbackType];
        return `store ${storeCtor.name}, event ${storeEventCtor.name}, system ${thisArg?.constructor.name}, description: ${description || this.worker.findDebugInfo(key)}, callback: ${callback}`;
    }

    private static resolveValueFunc(_callbackResult: any, event: Event) {
        return event;
    }
}

HookUtil.get(SubscribeHook).registerSubscriber(StoreEventSubscriber);
StoreEventInnerUtil.findKey = StoreEventSubscriber.findKey;
StoreEventInnerUtil.dispatch = StoreEventSubscriber.dispatch;

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// Timer
export interface IEnvTimer {
    setInterval: (callback: (...args: any[]) => void, timeout?: number, ...args: any[]) => number;
    setTimeout: (handler: (...args: any[]) => void, timeout?: number, ...args: any[]) => number;
    clearInterval: (handle?: number) => void;
    clearTimeout: (handle?: number) => void;
}

// 默认实现都用系统的；node 类型下定时器返回 Timeout、浏览器返回 number，这里统一以 number 名义透传
// （仅类型收窄，运行值原样交给 clearInterval/clearTimeout，跨运行时安全）
export const DEFAULT_ENV_TIMER: IEnvTimer = {
    setInterval: (callback, timeout, ...args) => setInterval(callback, timeout, ...args) as unknown as number,
    setTimeout: (handler, timeout, ...args) => setTimeout(handler, timeout, ...args) as unknown as number,
    clearInterval: (handle) => clearInterval(handle as unknown as Parameters<typeof clearInterval>[0]),
    clearTimeout: (handle) => clearTimeout(handle as unknown as Parameters<typeof clearTimeout>[0]),
};

export const TIMER_INTERVAL = Symbol("TimerInterval");
export const TIMER_INTERVAL_SECOND = Symbol("TimerIntervalSecond");
export const TIMER_DELAY = Symbol("TimerDelay");
export const TIMER_DELAY_SECOND = Symbol("TimerDelaySecond");

export type TimerType = typeof TIMER_INTERVAL | typeof TIMER_INTERVAL_SECOND | typeof TIMER_DELAY | typeof TIMER_DELAY_SECOND;
export type TimerCallback = () => void;

class TimerEnvData implements IEnvData {
    public envTimer: IEnvTimer = DEFAULT_ENV_TIMER;
    public allTimers = new Map<any, IStackTraceInfo>();

    public inheritFrom(source: TimerEnvData): void {
        this.envTimer = source.envTimer;
    }
}

export function setEnvTimer(env: number | string | Env, timreInfo: IEnvTimer) {
    let foundEnv = Env.find(env);
    assert(foundEnv && foundEnv.length > 0, `invalid env ${env}`);
    foundEnv[0].getData(TimerEnvData).envTimer = timreInfo;
}

declare module "../framework/System.js" {
    export interface System {
        /**
         * 订阅 Timer
         * @param timerType Timer类型
         * @param time 时间
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        subscribe<T extends TimerType>(timerType: T, time: number, callback: TimerCallback, thisArg?: System, description?: string): number;

        /**
         * 订阅 Timer，并指定 Handle
         * @param handle: 外部指定的Handle，不能为空
         * @param timerType Timer类型
         * @param time 时间
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         */
        subscribeWithHandle<T extends TimerType>(handle: symbol, timerType: T, time: number, callback: TimerCallback, thisArg?: System, description?: string): void;

        /**
         * 创建 Timer Promise
         * @param timerType Timer类型
         * @param time 时间
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns Promise
         */
        newPromise<T extends TimerType>(asyncHandle: symbol, timerType: T, time: number, callback?: TimerCallback, thisArg?: System, description?: string): Promise<void>;
    }
}

export class TimerSubscriber implements ISubscriber {
    public canProcess<T extends TimerType>(timerType: T): boolean {
        return timerType === TIMER_INTERVAL || timerType === TIMER_INTERVAL_SECOND || timerType === TIMER_DELAY || timerType === TIMER_DELAY_SECOND;
    }

    public equal(_sourceArgs: any[], _targetArgs: any[]): boolean {
        // 永远不等
        return false;
    }

    public subscribe<T extends TimerType>(info: SubscribeInstanceInfo, timerType: T, time: number, callback?: TimerCallback, thisArg?: System, description?: string): number {
        assert(info.resolve || callback, `subscribe store event failed, callback is invalid`);

        let timerData = Env.getCurrentData(TimerEnvData);
        let handle: any;
        let newCallback = verifySubscriberCallback(info, callback, thisArg, TimerSubscriber.resolveValueFunc, description);

        let timerTime = timerType === TIMER_DELAY || timerType === TIMER_INTERVAL ? time : time * 1000;
        // assert(timerTime <= 2147483647, `timer time is too long, ${timerTime}`);

        if (timerType === TIMER_DELAY || timerType === TIMER_DELAY_SECOND) {
            handle = timerData.envTimer.setTimeout(() => {
                newCallback.call(thisArg);
            }, timerTime);
        } else {
            handle = timerData.envTimer.setInterval(() => {
                newCallback.call(thisArg);
            }, timerTime);
        }
        timerData.allTimers.set(handle, description || getStackTraceInfo());
        return handle;
    }

    public unsubscribe<T extends TimerType>(info: SubscribeInstanceInfo, timerType: T): boolean {
        let timerData = Env.getCurrentData(TimerEnvData);

        if (timerType === TIMER_DELAY || timerType === TIMER_DELAY_SECOND) {
            timerData.envTimer.clearTimeout(info.subscribeResult as number);
        } else {
            timerData.envTimer.clearInterval(info.subscribeResult as number);
        }
        return true;
    }

    public getInfo<T extends TimerType>(info: SubscribeInstanceInfo | undefined, timerType: T, time: number, callback?: TimerCallback, thisArg?: System, description?: string): string {
        let timerData = Env.getCurrentData(TimerEnvData);

        return `${String(timerType)} timer, time: ${time}, system ${thisArg?.constructor.name}, description: ${timerData.allTimers.get(info?.subscribeResult as number)}, callback: ${callback}`;
    }

    private static resolveValueFunc(callbackResult: any) {
        return callbackResult;
    }
}

HookUtil.get(SubscribeHook).registerSubscriber(TimerSubscriber);

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// Timer Next tick 因为参数没有time，所以这里新写了个
export const TIMER_NEXT_TICK = Symbol("TimerNextTick");
export type TimerNextTickType = typeof TIMER_NEXT_TICK;

declare module "../framework/System.js" {
    export interface System {
        /**
         * 订阅 NextTick
         * @param timerType 必须为TIMER_NEXT_TICK
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        subscribe<T extends TimerNextTickType>(nextTickType: T, callback: TimerCallback, thisArg?: System, description?: string): number;

        /**
         * 订阅 NextTick，并指定 Handle
         * @param handle: 外部指定的Handle，不能为空
         * @param timerType 必须为TIMER_NEXT_TICK
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         */
        subscribeWithHandle<T extends TimerNextTickType>(handle: symbol, timerType: T, callback: TimerCallback, thisArg?: System, description?: string): void;

        /**
         * 创建 NextTick Promise
         * @param timerType 必须为TIMER_NEXT_TICK
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns Promise
         */
        newPromise<T extends TimerNextTickType>(asyncHandle: symbol, timerType: T, callback?: TimerCallback, thisArg?: System, description?: string): Promise<void>;
    }
}

export class TimerNextTickSubscriber implements ISubscriber {
    public canProcess<T extends TimerNextTickType>(timerType: T): boolean {
        return timerType === TIMER_NEXT_TICK;
    }

    public equal(_sourceArgs: any[], _targetArgs: any[]): boolean {
        // 永远不等
        return false;
    }

    public subscribe<T extends TimerNextTickType>(info: SubscribeInstanceInfo, _timerType: T, callback?: TimerCallback, thisArg?: System, description?: string): bigint {
        assert(info.resolve || callback, `subscribe store event failed, callback is invalid`);

        let timerData = Env.getCurrentData(TimerEnvData);
        let handle: any;
        let newCallback = verifySubscriberCallback(info, callback, thisArg, TimerNextTickSubscriber.resolveValueFunc, description);

        handle = timerData.envTimer.setTimeout(() => {
            newCallback.call(thisArg);
        }, 10);
        timerData.allTimers.set(handle, description || getStackTraceInfo());
        return handle;
    }

    public unsubscribe<T extends TimerType>(info: SubscribeInstanceInfo): boolean {
        let timerData = Env.getCurrentData(TimerEnvData);
        timerData.envTimer.clearTimeout(info.subscribeResult as number);
        return true;
    }

    public getInfo<T extends TimerType>(info: SubscribeInstanceInfo | undefined, _timerType: T, callback?: TimerCallback, thisArg?: System, description?: string): string {
        let timerData = Env.getCurrentData(TimerEnvData);

        return `next tick timer, system ${thisArg?.constructor.name}, description: ${description || timerData.allTimers.get(info?.subscribeResult as number)}, callback: ${callback}`;
    }

    private static resolveValueFunc(callbackResult: any) {
        return callbackResult;
    }
}

HookUtil.get(SubscribeHook).registerSubscriber(TimerNextTickSubscriber);
