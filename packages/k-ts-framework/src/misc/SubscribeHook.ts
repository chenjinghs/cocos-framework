import { Env } from "../framework/Env.js";
import { CallbackType, Constructor } from "../framework/Interface.js";
import { System } from "../framework/System.js";
import { assert } from "../global/GlobalFunctions.js";
import { HookOperatorBase, HookType } from "./HookUtilImpl.js";
import { ISubscriber, SubscribeHelper, SubscribeInstanceInfo, SubscriberRegistry } from "./Subscriber.js";

class SubscribeInfo {
    public constructor(
        public systemCtor: Constructor<System>,
        public isStaticFunc: boolean,
        public thisArgIndex: number | Array<number>,
        public args: any[],
    ) {}
}

export type OnDecoratorFunc = <T>(
    target: Object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>,
    ...args: any[]
) => boolean;

export type SubscribeCallbackHookFunc = (
    info: SubscribeInstanceInfo,
    callback: CallbackType | undefined,
    thisArg: any,
    description?: string,
) => CallbackType | undefined;

/**
 * System占位符
 */
export class SystemThisArgPlaceholder {
    public constructor(public target: any) {}
}

/**
 * 订阅相关的扩展处理
 */
export class SubscribeHook extends HookOperatorBase {
    protected onDecorators = new Array<OnDecoratorFunc>();
    protected subscribeInfos = new Map<Constructor<System>, Array<SubscribeInfo>>();
    protected subscribeCallbackHookFunc?: SubscribeCallbackHookFunc;

    /**
     * 注册订阅信息，必须在OnDecoratorFunc中使用，参数类型同subscriber，thisArg请使用SystemThisArgPlaceholder代替
     * 运行时会把SystemThisArgPlaceholder换成system，其他参数直接透传给subscriber，等同于运行时调用this.subscribe(...args)
     * @param args 参数同subscriber
     */
    public subscribeInDecorator(...args: any[]) {
        let count = args.length;
        let thisArgIndex: number | Array<number> | undefined;
        let target;

        for (let i = 0; i < count; ++i) {
            let arg = args[i];
            if (typeof arg === "object" && arg.constructor === SystemThisArgPlaceholder) {
                if (thisArgIndex === undefined) {
                    thisArgIndex = i;
                    target = arg.target;
                } else if (!Array.isArray(thisArgIndex)) {
                    thisArgIndex = [thisArgIndex as number, i];
                } else {
                    thisArgIndex.push(i);
                }
            }
        }
        assert(
            thisArgIndex !== undefined && target !== undefined,
            `subscribeInDecorator failed, can not find this arg placeholder`,
        );

        let systemCtor = this.getDecoratorSystemCtor(target) as Constructor<System>;
        let info = new SubscribeInfo(systemCtor, systemCtor === target, thisArgIndex, args);
        let infos = this.subscribeInfos.get(systemCtor);
        if (!infos) {
            infos = new Array<SubscribeInfo>();
            this.subscribeInfos.set(systemCtor, infos);
        }
        infos.push(info);
    }

    /**
     * 注册外部装饰器，方便外面自定义on
     *
     * 为了让外面扩展decorator，这里搞了这么一层，外面扩展时为了骗过编译器需要使用namespace，例子如下：\
     * declare module "./k-ts-framework" { \
     *    namespace D { \
     *        export function on(param1: string, param2: boolean, ...): MethodDecorator; \
     *    } \
     *} \
     * @param decorator 装饰器处理函数
     */
    public registerOnDecorator(decorator: OnDecoratorFunc) {
        this.onDecorators.push(decorator);
    }

    /**
     * 注册订阅器
     * @param ctor 订阅器构造函数
     * @returns
     */
    public registerSubscriber<T extends ISubscriber>(ctor: Constructor<T>) {
        Env.current.getData(SubscriberRegistry).register(ctor);
    }

    /**
     * 取消订阅器
     * @param ctor 订阅器构造函数
     */
    public unregisterSubscriber<T extends ISubscriber>(ctor: Constructor<T>) {
        Env.current.getData(SubscriberRegistry).unregister(ctor);
    }

    /**
     * 查询注册的订阅器
     * @param ctor 订阅器构造函数
     * @returns 订阅器
     */
    public getSubscriber<T extends ISubscriber>(ctor: Constructor<T>): T {
        let ret = Env.current.getData(SubscriberRegistry).find(ctor);
        assert(ret, `can not find subscriber ${ctor.name}`);
        return ret as T;
    }

    /**
     * 设置订阅器hook函数，可以根据需求定制所有订阅器的callback
     * @param func
     */
    public setSubscriberCallbackHook(func?: SubscribeCallbackHookFunc) {
        this.subscribeCallbackHookFunc = func;
    }

    // ///////////////////////////////////////////////////////////////////////////
    public getAllOnDecorators() {
        return this.onDecorators;
    }

    public getDescription(): string {
        return "subscriber";
    }

    public getHookType(): HookType | HookType[] {
        return HookType.onSystemPostCreate;
    }

    public inheritFrom(source: SubscribeHook) {
        for (const v of source.onDecorators) {
            if (!this.onDecorators.find((s) => s === v)) {
                this.onDecorators.push(v);
            }
        }

        for (const [systemCtor, infos] of source.subscribeInfos) {
            if (!this.subscribeInfos.has(systemCtor)) {
                this.subscribeInfos.set(systemCtor, infos);
            }
        }

        if (this.subscribeCallbackHookFunc === undefined)
            this.subscribeCallbackHookFunc = source.subscribeCallbackHookFunc;
    }

    public onSystemPostCreate(system: System, subscribeHelper: SubscribeHelper) {
        assert(system);
        let systemCtor = system.constructor as Constructor<System>;

        while (systemCtor && systemCtor !== System) {
            let infos = this.subscribeInfos.get(systemCtor);
            if (infos) {
                for (let info of infos) {
                    this.subscribe(system, subscribeHelper, info);
                }
            }
            systemCtor = Object.getPrototypeOf(systemCtor);
        }
    }

    public hookSubscriberCallback(
        info: SubscribeInstanceInfo,
        callback: CallbackType | undefined,
        thisArg: any,
        description?: string,
    ): CallbackType | undefined {
        if (this.subscribeCallbackHookFunc === undefined) return;
        else return this.subscribeCallbackHookFunc(info, callback, thisArg, description);
    }

    private subscribe(system: System, subscribeHelper: SubscribeHelper, info: SubscribeInfo) {
        let ctor = system.constructor;
        let thisArg = info.isStaticFunc ? ctor : system;
        let args = [...info.args];

        if (Array.isArray(info.thisArgIndex)) {
            for (const v of info.thisArgIndex) args[v] = thisArg;
        } else {
            args[info.thisArgIndex] = thisArg;
        }

        subscribeHelper.subscribe(...args);
    }

    private getDecoratorSystemCtor(target: unknown): Function {
        if (typeof target === "object") {
            return (target as object).constructor;
        } else {
            return target as Function;
        }
    }
}
