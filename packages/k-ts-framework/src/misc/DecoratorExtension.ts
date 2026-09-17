import { Action, InferActionReturnType, InferStoreActionReturnType, StoreAction } from "../framework/Action";
import { Event, StoreEvent } from "../framework/Event";
import { Store } from "../framework/Store";
import { assert, isChildOf } from "../global/GlobalFunctions";
import { HookUtil } from "./HookUtilImpl";
import { SubscribeHook, SystemThisArgPlaceholder } from "./SubscribeHook";

type FunctionParamType<T> = T extends (param: infer P) => any ? P : never;
type VerifyActionOrEvent<Type, TReturn> = Type extends Action<any> | Event ? TReturn : never;
type VerifyStoreActionOrStoreEvent<Type, TReturn> = Type extends StoreAction<any> | StoreEvent ? TReturn : never;

declare module "../framework/Decorator" {
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
function actionEventOn(target: any, _propertyKey: string | symbol, descriptor: PropertyDescriptor, ...args: any[]) {
    if (args.length > 1) return false;

    // esbuild/tsx 等转换器不发射 emitDecoratorMetadata，此时无法判定事件类型；
    // 吞掉装饰器保证模块可加载（真实构建由 tsc/webpack 发射 metadata，订阅行为不变）
    let paramTypes = Reflect.getMetadata("design:paramtypes", target, _propertyKey) as Array<any> | undefined;
    if (paramTypes === undefined) return true;
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
