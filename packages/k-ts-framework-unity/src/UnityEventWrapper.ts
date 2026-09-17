import { F } from "k-ts-framework";

export type SupportedUnityEvent = CS.UnityEngine.Events.UnityEventBase;
export const SupportedUnityEvent = CS.UnityEngine.Events.UnityEventBase;

export class UnityEventWrapper {
    public static addListener(event: SupportedUnityEvent, callback: F.CallbackType, thisArg?: any, info?: string): UnityEventWrapper {
        return new UnityEventWrapper(event, callback, thisArg, false, info || F.getStackTraceInfo());
    }

    private static processCallback(env: F.Env, thisArg: any, callback: F.CallbackType, info: F.IStackTraceInfo, ...args: any[]): any {
        F.assert(env.valid, `call delegate failed, the env [${env.name}] is invalid, info: ${info}`);
        F.assert(F.canRunInThisThread(), `call delegate failed, the current thread is not valid, info: ${info}`);

        let ret;
        F.Env.scope(env, () => {
            if (thisArg) {
                ret = callback.call(thisArg, ...args);
            } else {
                ret = callback(...args);
            }
        });
        return ret;
    }

    private bondedCallback?: F.CallbackType;

    private constructor(private event: SupportedUnityEvent, private callback: F.CallbackType, private thisArg: any, private isMulticast: boolean, private info: string | F.IStackTraceInfo) {
        F.assert(event);
        F.assert(callback);

        this.addListener(this.callback, thisArg, info);
    }

    public addListener<T extends F.CallbackType>(callback: T, thisArg: any, info: F.IStackTraceInfo) {
        this.removeListener();

        let env = F.Env.current;
        this.bondedCallback = function (...args: any[]): any {
            return UnityEventWrapper.processCallback(env, thisArg, callback, info, ...args);
        };

        (this.event as any).AddListener(this.bondedCallback);
    }

    public removeListener() {
        if (this.event && this.bondedCallback) {
            (this.event as any).RemoveListener(this.bondedCallback);
            this.bondedCallback = undefined;
        }
    }

    public getInfo(): string {
        return F.getStackTraceInfoString(this.info) || `${this.callback}`;
    }

    public getDelegate() {
        return this.event;
    }

    public getCallback() {
        return this.callback;
    }

    public getThisArg() {
        return this.thisArg;
    }

    public equal(delegate: SupportedUnityEvent, callback: F.CallbackType, thisArg: any) {
        return this.event === delegate && this.callback === callback && this.thisArg === thisArg;
    }
}
