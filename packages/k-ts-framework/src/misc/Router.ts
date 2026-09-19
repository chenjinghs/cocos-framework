import { Action, StoreAction } from "../framework/Action.js";
import { D } from "../framework/Decorator.js";
import { Event, StoreEvent } from "../framework/Event.js";
import { Constructor, EDataInheritType } from "../framework/Interface.js";
import { assert } from "../global/GlobalFunctions.js";
import { HookType, HookUtil } from "./HookDefine.js";
import { HookOperatorBase } from "./HookUtilImpl.js";

export type RouteTargetType = Action<unknown> & StoreAction<unknown> & Event & StoreEvent;
export type RouteDecoratorFunc = <T extends RouteTargetType>(ctor: Constructor<T>, ...args: any[]) => boolean;

export class RouterHook extends HookOperatorBase {
    public routeFuncs = new Array<RouteDecoratorFunc>();

    public inheritFrom(source: RouterHook, _dataInheritType: EDataInheritType) {
        for (let v of source.routeFuncs) {
            this.routeFuncs.push(v);
        }
    }

    public getDescription(): string {
        return "router";
    }

    public getHookType(): HookType | HookType[] {
        return [];
    }

    public registerRouter(func: RouteDecoratorFunc) {
        this.routeFuncs.push(func);
    }
}

/**
 * 要求只能是action或者event类型
 */
(D as any).route = function (...args: any[]) {
    return function (target: any) {
        let type = target.selfType;
        assert(
            type === Action || type === Event || type === StoreAction || type === StoreEvent,
            "route decorator must be used on Action, Event, StoreAction or StoreEvent"
        );

        let routeFuncs = HookUtil.get(RouterHook).routeFuncs;
        for (let v of routeFuncs) {
            if (v(target, ...args)) return;
        }

        assert(false, "route failed, there is no processor");
    };
};
