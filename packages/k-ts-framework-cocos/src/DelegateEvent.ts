import { F } from "k-ts-framework";

import { cc } from "./cc";
import { CocosEventWrapper } from "./EventWrapper";

/**
 * 可订阅的 cc 事件描述：目标 EventTarget + 事件名。
 * subscribe(new SupportedCocosEvent(node, "click"), callback) 即完成组件事件桥接。
 */
export class SupportedCocosEvent {
    public constructor(
        public readonly target: cc.EventTarget,
        public readonly eventName: string,
    ) {}
}

class DelegateSubscriber implements F.ISubscriber {
    public canProcess(event: SupportedCocosEvent): boolean {
        return event instanceof SupportedCocosEvent;
    }

    public equal(sourceArgs: unknown[], targetArgs: unknown[]): boolean {
        // event, callback, thisArgs(option)
        return F.checkArgsEqual(sourceArgs, targetArgs, 2, 3);
    }

    public subscribe(info: F.SubscribeInstanceInfo, event: SupportedCocosEvent, callback: F.CallbackType, thisArg?: F.System, description?: string): CocosEventWrapper {
        F.assert(info.resolve || callback, `subscribe event failed, callback is invalid`);

        let newCallback = F.verifySubscriberCallback(info, callback ?? F.EMPTY_CALLBACK, thisArg, DelegateSubscriber.resolveValueFunc, description);
        return CocosEventWrapper.addListener(event.target, event.eventName, newCallback, thisArg, description);
    }

    public unsubscribe<T extends F.CallbackType>(info: F.SubscribeInstanceInfo, _event: SupportedCocosEvent, _callback?: T, _thisArg?: F.System): boolean {
        (info.subscribeResult as CocosEventWrapper).removeListener();
        return true;
    }

    public getInfo<T extends F.CallbackType>(info: F.SubscribeInstanceInfo | undefined, event: SupportedCocosEvent, callback?: T, thisArg?: F.System, description?: string): string {
        return `event ${event.eventName}, system ${thisArg?.constructor.name}, description: ${description || (info?.subscribeResult as CocosEventWrapper)?.getInfo()}, callback: ${callback}`;
    }

    private static resolveValueFunc(_callbackResult: unknown, ...args: unknown[]) {
        return args;
    }
}

/** 注册 cc 组件事件桥接订阅器（由 registerKFrameworkCocos 调用，幂等） */
export function registerDelegateSubscriber() {
    F.HookUtil.get(F.SubscribeHook).registerSubscriber(DelegateSubscriber);
}

declare module "k-ts-framework" {
    export interface System {
        /**
         * 订阅 cc 事件
         * @param event SupportedCocosEvent 实例
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         * @returns 订阅id
         */
        subscribe(event: SupportedCocosEvent, callback: F.CallbackType, thisArg?: System, description?: string): number;

        /**
         * 订阅 cc 事件，并指定 Handle
         * @param handle 外部指定的Handle，不能为空
         * @param event SupportedCocosEvent 实例
         * @param callback 处理函数
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         */
        subscribeWithHandle(handle: symbol, event: SupportedCocosEvent, callback: F.CallbackType, thisArg?: System, description?: string): void;

        /**
         * 订阅 cc 事件（Promise 形式）
         * @param asyncHandle 异步句柄
         * @param event SupportedCocosEvent 实例
         * @param callback 处理函数，可选
         * @param thisArg System实例，可选
         * @param description 描述信息，可选
         */
        newPromise<T>(asyncHandle: symbol, event: SupportedCocosEvent, callback?: F.CallbackType, thisArg?: System, description?: string): Promise<T | undefined>;
    }
}
