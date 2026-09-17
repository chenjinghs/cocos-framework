import { F } from "k-ts-framework";

import { cc } from "./cc";

/**
 * cc.EventTarget 事件包装器，对齐 Unity 版 UnityEventWrapper 的语义：
 * 回调在订阅时的 env 作用域内执行，且校验线程可运行标记。
 */
export class CocosEventWrapper {
    public static addListener(target: cc.EventTarget, eventName: string, callback: F.CallbackType, thisArg?: unknown, info?: string): CocosEventWrapper {
        return new CocosEventWrapper(target, eventName, callback, thisArg, info || F.getStackTraceInfo());
    }

    private static processCallback(env: F.Env, thisArg: unknown, callback: F.CallbackType, info: F.IStackTraceInfo, args: unknown[]): unknown {
        F.assert(env.valid, `call delegate failed, the env [${env.name}] is invalid, info: ${info}`);
        F.assert(F.canRunInThisThread(), `call delegate failed, the current thread is not valid, info: ${info}`);

        let ret: unknown;
        F.Env.scope(env, () => {
            if (thisArg) {
                ret = callback.call(thisArg, ...args);
            } else {
                ret = callback(...args);
            }
        });
        return ret;
    }

    private bondedCallback?: (...args: unknown[]) => void;

    private constructor(
        private target: cc.EventTarget,
        private eventName: string,
        private callback: F.CallbackType,
        private thisArg: unknown,
        private info: string | F.IStackTraceInfo,
    ) {
        F.assert(target, "CocosEventWrapper: target is invalid");
        F.assert(callback, "CocosEventWrapper: callback is invalid");

        this.addListener(callback, thisArg, info);
    }

    public addListener<T extends F.CallbackType>(callback: T, thisArg: unknown, info: string | F.IStackTraceInfo) {
        this.removeListener();

        let env = F.Env.current;
        this.bondedCallback = (...args: unknown[]): unknown => {
            return CocosEventWrapper.processCallback(env, thisArg, callback, info, args);
        };

        this.target.on(this.eventName, this.bondedCallback, thisArg);
    }

    public removeListener() {
        if (this.target && this.bondedCallback) {
            this.target.off(this.eventName, this.bondedCallback, this.thisArg);
            this.bondedCallback = undefined;
        }
    }

    public getInfo(): string {
        return F.getStackTraceInfoString(this.info) || `${this.callback}`;
    }

    public getTarget() {
        return this.target;
    }

    public getEventName() {
        return this.eventName;
    }

    public getCallback() {
        return this.callback;
    }

    public getThisArg() {
        return this.thisArg;
    }

    public equal(target: cc.EventTarget, eventName: string, callback: F.CallbackType, thisArg: unknown) {
        return this.target === target && this.eventName === eventName && this.callback === callback && this.thisArg === thisArg;
    }
}
