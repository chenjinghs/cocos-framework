import { Action, InferActionReturnType, InferStoreActionReturnType, StoreAction } from "../framework/Action.js";
import { Event, StoreEvent } from "../framework/Event.js";
import { Store } from "../framework/Store.js";
import { assert, isChildOf } from "../global/GlobalFunctions.js";
import { HookUtil } from "./HookUtilImpl.js";
import { SubscribeHook, SystemThisArgPlaceholder } from "./SubscribeHook.js";

type FunctionParamType<T> = T extends (param: infer P) => any ? P : never;
type VerifyActionOrEvent<Type, TReturn> = Type extends Action<any> | Event ? TReturn : never;
type VerifyStoreActionOrStoreEvent<Type, TReturn> = Type extends StoreAction<any> | StoreEvent ? TReturn : never;

declare module "../framework/Decorator.js" {
    namespace D {
        /**
         * 订阅Action或者Event, 标记的函数参数必须为1个且为Action或者Event类型,
         * 只支持对System中的函数进行标记
         */
        export function on(): <T>(
            target: Object,
            propertyKey: string | symbol,
            descriptor: TypedPropertyDescriptor<T>,
        ) => TypedPropertyDescriptor<(param: FunctionParamType<T>) => VerifyActionOrEvent<FunctionParamType<T>, InferActionReturnType<FunctionParamType<T>>>>;

        /**
         * 订阅 StoreAction或者StoreEvent, 标记的函数参数必须为1个且为StoreAction或者StoreEvent类型,
         * 只支持对System中的函数进行标记
         * @param storeCtor Store类型
         */
        // @ts-ignore func-style, prefer-arrow/prefer-arrow-functions
        export function on<TStore extends typeof Store>(
            storeCtor: TStore,
        ): <T>(
            target: Object,
            propertyKey: string | symbol,
            descriptor: TypedPropertyDescriptor<T>,
        ) => TypedPropertyDescriptor<(param: FunctionParamType<T>) => VerifyStoreActionOrStoreEvent<FunctionParamType<T>, InferStoreActionReturnType<FunctionParamType<T>>>>;
    }
}

// /////////////////////////////////////////////////////////////////////////////////////////////////////////
// Action & Event

// 元数据缺失是工具链级别的事实（整条链路要么都有要么都没有），告警一次即可，不逐点刷屏
let metadataMissingWarned = false;

/** 兼容 legacy(prototype, key) 与 stage-3(method, context) 两种签名，仅用于告警文案定位 */
function resolveMemberName(target: unknown, propertyKeyOrContext: unknown): string {
    let ctx = propertyKeyOrContext as { name?: unknown } | null;
    if (ctx !== null && typeof ctx === "object" && (typeof ctx.name === "string" || typeof ctx.name === "symbol")) {
        // stage-3 下 target 是方法本身，拿不到持有类
        return String(ctx.name);
    }
    let holder = target as { constructor?: Function } | null;
    return `${holder?.constructor?.name ?? "<unknown>"}.${String(propertyKeyOrContext as string | symbol)}`;
}

function actionEventOn(target: any, _propertyKey: string | symbol, descriptor: PropertyDescriptor, ...args: any[]) {
    if (args.length > 1) return false;

    // esbuild/tsx 等转换器不发射 emitDecoratorMetadata，此时无法判定事件类型；
    // 吞掉装饰器保证模块可加载（真实构建由 tsc/webpack 发射 metadata，订阅行为不变）。
    // 但"吞掉"= 该订阅静默失效，必须告警，否则测试里看到的是一个永不触发的订阅。
    let paramTypes = Reflect.getMetadata("design:paramtypes", target, _propertyKey) as Array<any> | undefined;
    if (paramTypes === undefined) {
        if (!metadataMissingWarned) {
            metadataMissingWarned = true;
            console.warn(
                `[k-ts-framework] @D.on 订阅未生效：当前工具链未发射 emitDecoratorMetadata（tsx/esbuild 等），` +
                    `无法从参数类型推断 Action/Event，本次运行中所有 @D.on 声明都会被跳过` +
                    `（首个：${resolveMemberName(target, _propertyKey)}）。` +
                    `tsc/Creator 生产构建会发射 metadata，行为不受影响；单测中请改用 this.subscribe(...)。`,
            );
        }
        return true;
    }
    if (paramTypes.length !== 1) return false;

    let storeCtor = args[0];
    let aeCtor = paramTypes[0];
    let aeType = aeCtor.selfType;
    if (aeType !== StoreEvent && aeType !== Event && aeType !== Action && aeType !== StoreAction) return false;
    assert(storeCtor === undefined || isChildOf(storeCtor, Store), `input param is not supported in function 'on'`);

    let callback = descriptor.value;
    let thisArg = new SystemThisArgPlaceholder(target);

    if (storeCtor === undefined) {
        HookUtil.get(SubscribeHook).subscribeInDecorator(aeCtor, callback, thisArg);
    } else {
        HookUtil.get(SubscribeHook).subscribeInDecorator(storeCtor, aeCtor, callback, thisArg);
    }
    return true;
}

HookUtil.get(SubscribeHook).registerOnDecorator(actionEventOn);
