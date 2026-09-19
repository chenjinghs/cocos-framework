import "reflect-metadata";

import { assert } from "../global/GlobalFunctions.js";
import { HookUtil } from "../misc/HookDefine.js";
import { SubscribeHook } from "../misc/SubscribeHook.js";
import { SingletonStore, Store } from "./Store.js";
import { System } from "./System.js";

/**
 * 订阅器目标
 */
// export interface ISubscribeTarget {
//     // public constructor(public callback: CallbackType, public thisArg?: System, public debugInfo?: string) {}
//     generateKey(): unknown;
//     subscribe(...args: any[]): boolean;
//     unsubscribe(...args: any[]): boolean;
// }

export type ClassDecorator = <TFunction extends Function>(target: TFunction) => TFunction | void;
export type PropertyDecorator = (target: Object, propertyKey: string | symbol) => void;
export type MethodDecorator = <T>(
    target: Object,
    propertyKey: string | symbol,
    descriptor: TypedPropertyDescriptor<T>, // 标记的函数声明，一版这里给T
) => TypedPropertyDescriptor<T> | void; // 限定的函数格式，这里对T进行分析和限制
export type ParameterDecorator = (target: Object, propertyKey: string | symbol, parameterIndex: number) => void;
export type PromiseConstructorLike = new <T>(
    executor: (resolve: (value: T | PromiseLike<T>) => void, reject: (reason?: any) => void) => void,
) => PromiseLike<T>;

export function getDecoratorSystemCtor(target: unknown): Function {
    if (typeof target === "object") {
        return (target as object).constructor;
    } else {
        return target as Function;
    }
}

// //////////////////////////////////////////////////////////////////////////
export class D {
    /**
     * 注册Store
     * @param tag 标签
     */
    public static store(tag?: string) {
        return function <T extends typeof Store>(ctor: T) {
            let prototype = Object.getPrototypeOf(ctor);
            assert(
                prototype === Store || prototype === SingletonStore,
                `decorator must be used on store which inherits Store or SingletonStore directly`,
            );
            Store.register.call(ctor, tag);
        };
    }

    /**
     * 注册System
     * @param tag 标签
     * @param stores 可修改的Store类型
     * @param envType 可指定环境类型，默认使用当前环境
     */
    public static system<T extends typeof Store>(tag: string, stores?: T | T[], envType?: number) {
        return function <TSystem extends typeof System>(ctor: TSystem) {
            assert(
                Object.getPrototypeOf(ctor) === System,
                "decorator must be used on system which inherits System directly",
            );
            System.register.call(ctor, tag, stores, envType);
        };
    }

    /**
     * @deprecated
     * 注册System friend
     * @param tag 标签
     */
    // public static friend(tag: string) {
    //     return function <T extends typeof System>(ctor: T) {
    //         assert(
    //             Object.getPrototypeOf(ctor) === System,
    //             "friend decorator must be used on system which inherits System directly",
    //         );
    //         System.registerFriend(ctor, tag);
    //     };
    // }
}

/**
 * 根据注册的decorator进行处理
 * PS：这里为了支持扩展，所以拿出来单独定义
 */
D.on = function (...args: any[]): any {
    return function (target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor) {
        let decorators = HookUtil.get(SubscribeHook).getAllOnDecorators();
        for (let v of decorators) {
            if (v(target, propertyKey, descriptor, ...args)) return;
        }
        assert(false, "on failed, there is no processor");
    };
};

// ///////////////////////////////////////////////////////////////////////////

// // delegate & multicast delegate
// registerOnDecorator(
//     (target: any, _propertyKey: string | symbol, descriptor: PropertyDescriptor, ...args: any[]): boolean => {
//         if (args.length !== 1) return false;

//         let param = args[0];
//         let isMulticast;
//         if ("Execute" in param) {
//             // delegate
//             isMulticast = false;
//         } else if ("Broadcast" in param) {
//             // multicast delegate
//             isMulticast = true;
//         } else {
//             return false;
//         }

//         let systemCtor = getDecoratorSystemCtor(target);
//         HookUtil.get(SubscribeOperator).register(
//             systemCtor,
//             param,
//             descriptor.value,
//             systemCtor === target,
//             isMulticast,
//             undefined
//         );
//         return true;
//     }
// );

// // action & event
// registerOnDecorator(
//     (target: any, _propertyKey: string | symbol, descriptor: PropertyDescriptor, ...args: any[]): boolean => {
//         if (args.length > 1) return false;

//         let param = args[0];
//         let systemCtor = getDecoratorSystemCtor(target);
//         let paramTypes = Reflect.getMetadata("design:paramtypes", target, _propertyKey) as Array<any>;
//         if (paramTypes.length !== 1) return false;

//         let aeType = paramTypes[0].selfType;
//         if (aeType !== StoreEvent && aeType !== Event && aeType !== Action && aeType !== StoreAction) return false;
//         assert(param === undefined || isChildOf(param, Store), `input param is not supported in function 'on'`);

//         if (
//             !HookUtil.get(SubscribeOperator).register(
//                 systemCtor,
//                 paramTypes[0],
//                 descriptor.value,
//                 systemCtor === target,
//                 aeType === StoreEvent || aeType === Event,
//                 param
//             )
//         ) {
//             assert(false, `there must be only one subscriber when process ${systemCtor.name}, ${paramTypes[0].name}`);
//         }
//         return true;
//     }
// );
