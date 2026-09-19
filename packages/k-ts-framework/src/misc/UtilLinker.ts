import { D } from "../framework/Decorator.js";
import { Env } from "../framework/Env.js";
import { Constructor, getManager, IEnvData, IStartAsyncExtraOutput, SystemConstructor } from "../framework/Interface.js";
import { assert, getStackTraceInfo } from "../global/index.js";
import { cancelAsyncChainIfAllParentsDestroyed } from "./AsyncInfo.js";
import { HookType, HookUtil } from "./HookDefine.js";

type NonPromise<T> = T extends Promise<any> ? never : T;
type IsPromise<T> = T extends Promise<any> ? true : false;
type IsPromiseFunc<T> = T extends (...args: any[]) => infer R ? IsPromise<R> : false;

export type UtilFunctionType = (...args: any[]) => NonPromise<any>;
export type AsyncUtilFunctionType = (asyncHandle: symbol, ...args: any[]) => Promise<any>;
export type LinkFuncType<T> = IsPromiseFunc<T> extends true ? (asyncHandle: symbol, ...args: any[]) => Promise<any> : (...args: any[]) => NonPromise<any>;

declare module "../framework/Decorator.js" {
    namespace D {
        export function linkUtil<TFunc extends (...args: any[]) => any>(
            func: TFunc,
        ): <T extends (...args: any[]) => any>(target: Object, propertyKey: string | symbol, descriptor: TypedPropertyDescriptor<T>) => TypedPropertyDescriptor<TFunc>;
    }
}

interface IAsyncUtilLinkerOptions {
    canRunMultiPromiseAtOneTime?: boolean;
}

class UtilLinker {
    public func?: Function;
    public ctor?: Constructor<any>;

    public constructor(public asyncOptions?: IAsyncUtilLinkerOptions) {}
}

class UtilLinkerRegistry implements IEnvData {
    public maxHandle = 0;
    public funcToLinker = new Map<Function, UtilLinker>();
    public handleToLinker = new Map<number, UtilLinker>();

    public inheritFrom(source: UtilLinkerRegistry) {
        let inherited;
        this.maxHandle = Math.max(this.maxHandle, source.maxHandle);

        let oldLinkerToNew = new Map<UtilLinker, UtilLinker>();
        for (let [func, linker] of source.funcToLinker) {
            inherited = new UtilLinker();
            inherited.func = linker.func;
            this.funcToLinker.set(func, inherited);
            oldLinkerToNew.set(linker, inherited);
        }
        for (let [handle, linker] of source.handleToLinker) {
            inherited = oldLinkerToNew.get(linker);
            this.handleToLinker.set(handle, inherited!);
        }
    }
}

export function createUtilLinker<T extends UtilFunctionType>(): T {
    return createUtilLinkerImpl() as T;
}

export function createAsyncUtilLinker<T extends AsyncUtilFunctionType>(canRunMultiPromiseAtOneTime?: boolean): T {
    return createUtilLinkerImpl({ canRunMultiPromiseAtOneTime }) as T;
}

export function clearUtilLinkerWithSystemCtors(systemCtors: SystemConstructor[]) {
    const ctorSet = new Set(systemCtors);
    let linkers = Env.getCurrentData(UtilLinkerRegistry).funcToLinker;
    for (let [_, linker] of linkers) {
        if (linker.ctor && ctorSet.has(linker.ctor)) {
            linker.ctor = undefined;
            linker.func = undefined;
        }
    }
}

function createUtilLinkerImpl(asyncOptions?: IAsyncUtilLinkerOptions) {
    let linker = new UtilLinker(asyncOptions);
    let registry = Env.getCurrentData(UtilLinkerRegistry);
    let handle = ++registry.maxHandle;

    let ret = function (...args: any[]): any {
        let linkerFunc = Env.getCurrentData(UtilLinkerRegistry).handleToLinker.get(handle)?.func;
        assert(linkerFunc, `util function has not been linked`);
        return linkerFunc(...args);
    };

    registry.funcToLinker.set(ret, linker);
    registry.handleToLinker.set(handle, linker);
    return ret as any;
}

(D as any).linkUtil = function <T extends UtilFunctionType | AsyncUtilFunctionType>(utilLinkerFunction: T) {
    return function (target: any, property: string) {
        let linker = Env.getCurrentData(UtilLinkerRegistry).funcToLinker.get(utilLinkerFunction);
        assert(linker, `link util failed, can not find source util function`);
        assert(!linker.func, `link util failed, the target function has been linked`);

        let ctor = target.constructor;
        let func = Object.getOwnPropertyDescriptor(target, property)?.value;
        assert(typeof func === "function", `link util failed, ${property} in ${ctor.name} is not a valid function`);

        let asyncOptions = linker.asyncOptions;

        linker.ctor = ctor;
        linker.func = (...args: any[]): any => {
            let parentAsyncHandle: symbol | undefined;
            if (asyncOptions) {
                const funcName = `async util function ${ctor.name}.${property} `;
                assert(args.length > 0 && typeof args[0] === "symbol", funcName + `must have asyncHandle as first argument`);
                parentAsyncHandle = args[0];
                assert(typeof parentAsyncHandle === "symbol", funcName + `must have asyncHandle as first argument`);

                // 异步执行过程中所有系统被销毁，此时不应该再执行
                cancelAsyncChainIfAllParentsDestroyed(parentAsyncHandle, funcName + `is canceled because all parent async are destroyed`);
            }

            let system = getManager().findSystem(ctor);
            assert(system, `system ${ctor.name} can not be accessed, function: ${property}`);

            HookUtil.triggerHook(HookType.onUtilLinkerPreCall, system, property, ...args);
            let ret;

            if (asyncOptions) {
                let output = {} as IStartAsyncExtraOutput;

                getManager()
                    .getSystemSubscribeHelper(system)
                    .startAsync(
                        {
                            callback: (newHandle) => func.call(system, newHandle, ...args.slice(1)),
                            parentAsyncHandle,
                            canRunMultiPromiseAtOneTime: asyncOptions.canRunMultiPromiseAtOneTime,
                            description: getStackTraceInfo(),
                        },
                        output,
                    );
                ret = output.rootPromise;
            } else {
                ret = func.call(system, ...args);
            }

            HookUtil.triggerHook(HookType.onUtilLinkerPostCall, system, property, ret, ...args);
            return ret;
        };
    };
};
