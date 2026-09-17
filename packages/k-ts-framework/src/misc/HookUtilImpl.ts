import { Action, StoreAction } from "../framework/Action";
import { Env } from "../framework/Env";
import { Event, StoreEvent } from "../framework/Event";
import { EDataInheritType, IEnvData, StoreConstructor } from "../framework/Interface";
import { Store, StoreProxy } from "../framework/Store";
import { System } from "../framework/System";
import { assert } from "../global/GlobalFunctions";
import { HookProcessor, HookType, HookUtil, IHookOperator, VerifyGetReturn } from "./HookDefine";
import { SubscribeHelper } from "./Subscriber";

type Constructor<T> = new (...args: any[]) => T;

export type ActionDoFunc = (action: Action<unknown>) => unknown;
export type StoreActionDoFunc = (action: StoreAction<unknown>, store: Readonly<Store>) => unknown;
export type EventDispatchFunc = (event: Event) => void;
export type StoreEventDispatchFunc = (storeEvent: StoreEvent, store: Readonly<Store>) => void;

export abstract class HookOperatorBase implements IHookOperator {
    /**
     * Store注册时触发
     * @param _storeCtor
     * @param _tag
     */
    public onStoreRegister(_storeCtor: StoreConstructor, _tag?: string) {}

    /**
     * Store创建前调用
     * @param _storeCtor
     * @param _tag
     */
    public onStoreVerifyTag(_tag: string) {}

    /**
     * System注册时触发
     * @param _systemCtor
     * @param _tag
     */
    public onSystemRegister(_systemCtor: Constructor<System>, _tag: string, _stores: StoreConstructor | StoreConstructor[], _envType?: number) {}

    /**
     * System创建前调用
     * @param _systemCtor
     * @param _tag
     */
    public onSystemVerifyTag(_tag: string) {}

    /**
     * System创建后被调用
     * @param system System
     * @param subscribeHelper System使用的订阅帮助类
     */
    public onSystemPostCreate(_system: System, _subscribeHelper: SubscribeHelper) {}

    /**
     * System Init前被调用
     * @param system System
     * @param subscribeHelper System使用的订阅帮助类
     */
    public onSystemPreInit(_system: System, _subscribeHelper: SubscribeHelper) {}

    /**
     * System Init后被调用
     * @param system System
     * @param subscribeHelper System使用的订阅帮助类
     */
    public onSystemPostInit(_system: System, _subscribeHelper: SubscribeHelper) {}

    /**
     * System删除前调用
     * @param system System
     * @param subscribeHelper System使用的订阅帮助类
     */
    public onSystemPreDestroy(_system: System, _subscribeHelper: SubscribeHelper) {}

    /**
     * System删除后调用
     * @param system System
     * @param subscribeHelper System使用的订阅帮助类
     */
    public onSystemPostDestroy(_system: System, _subscribeHelper: SubscribeHelper) {}

    /**
     * Store创建后调用
     * @param store Store
     * @param proxy Store代理，可对Store进行替换或者包装
     */
    public onStorePostCreate(_store: Store, _proxy: StoreProxy) {}

    /**
     * 分发StoreChanged的事件前调用
     * @param store Store
     */
    // public onStorePostUpdate(store: Store) {}

    /**
     * Store删除前调用
     * @param store Store
     */
    public onStorePreDestroy(_store: Store) {}

    /**
     * Store修改前调用
     * @param store Store
     */
    public onStorePreModify(_store: Store) {}

    /**
     * Store修改后调用
     * @param store Store
     * @param changed 是否成功修改（modify函数返回值）
     */
    public onStorePostModify(_store: Store, _changed: boolean) {}

    /**
     * Action执行前调用
     * @param action Action
     */
    public onActionPreDo(_action: Action<unknown>, _processor: HookProcessor) {}

    /**
     * Action执行后调用
     * @param action Action
     * @package result Action执行完结果
     */
    public onActionPostDo(_action: Action<unknown>, _result: unknown) {}

    /**
     * Event执行前调用
     * @param event Event
     */
    public onEventPreDispatch(_event: Event, _processor: HookProcessor) {}

    /**
     * Event执行后调用
     * @param event Event
     */
    public onEventPostDispatch(_event: Event) {}

    /**
     * StoreAction执行前调用
     * @param action StoreAction
     */
    public onStoreActionPreDo(_action: StoreAction<unknown>, _store: Readonly<Store>, _doWrapper: HookProcessor) {}

    /**
     * StoreAction执行后调用
     * @param action StoreAction
     * @param result StoreAction执行完结果
     */
    public onStoreActionPostDo(_action: StoreAction<unknown>, _store: Readonly<Store>, _result: unknown) {}

    /**
     * StoreEvent执行前调用
     * @param event StoreEvent
     */
    public onStoreEventPreDispatch(_event: StoreEvent, _store: Readonly<Store>, _dispatchWrapper: HookProcessor) {}

    /**
     * StoreEvent 执行后调用
     * @param event StoreEvent
     */
    public onStoreEventPostDispatch(_event: StoreEvent, _store: Readonly<Store>) {}

    /**
     * UtilLinker 调用前调用
     */
    public onUtilLinkerPreCall(_system: System, _funcName: string, ..._args: any[]) {}

    /**
     * UtilLinker 调用后调用
     */
    public onUtilLinkerPostCall(_system: System, _funcName: string, _ret: unknown, ..._args: any[]) {}

    /**
     * 获取描述
     */
    public abstract getDescription(): string;

    /**
     * 获取Hook类型
     */
    public abstract getHookType(): HookType | HookType[];

    /**
     * 创建子类Env时调用，本router继承自source的数据
     * @param source 来源
     */
    public abstract inheritFrom(source: HookOperatorBase, dataInheritType: EDataInheritType): void;
}

// /////////////////////////////////////////////////////////////////////////////////////////////////////////////
class HookData implements IEnvData {
    public opInfos = new Array<IHookOperator[] | undefined>();
    public ctorToOp = new Map<Constructor<IHookOperator>, IHookOperator>();

    public inheritFrom(source: HookData, dataInheritType: EDataInheritType) {
        for (const v of source.ctorToOp) {
            let ctor = v[0];
            let hook = this.ctorToOp.get(ctor);
            if (!hook) {
                hook = HookUtilImp.createImp<IHookOperator>(this, ctor);
            }
            hook.inheritFrom(v[1], dataInheritType);
        }
    }
}

class HookUtilImp {
    public static get<T extends IHookOperator, TCreate extends boolean = true>(ctor: Constructor<T>, createIfNotExists?: TCreate): VerifyGetReturn<T, TCreate> {
        let data = Env.current.getData(HookData);
        let ret = data.ctorToOp.get(ctor);
        if (!ret && (createIfNotExists === undefined || createIfNotExists)) {
            ret = HookUtilImp.createImp(data, ctor);
        }

        return ret as T;
    }

    public static triggerHook(hookType: HookType, ...args: any[]) {
        let data = Env.current.getData(HookData);
        let hookOperators = data.opInfos[hookType];
        if (hookOperators !== undefined) {
            for (let v of hookOperators) {
                let func = (v as any)[HookType[hookType]] as Function;
                func.call(v, ...args);
            }
        }
    }

    public static destroy<T extends IHookOperator>(ctor: Constructor<T>): boolean {
        return HookUtilImp.destroyImp(Env.current.getData(HookData), ctor);
    }

    public static create<T extends IHookOperator>(ctor: Constructor<T>) {
        return this.get(ctor, true);
    }

    public static createImp<T extends IHookOperator>(data: HookData, ctor: Constructor<T>): T {
        let ret = new ctor();
        data.ctorToOp.set(ctor, ret);
        let hookType = ret.getHookType();
        if (typeof hookType === "number") {
            this.register(data, ret, hookType);
        } else {
            for (let v of hookType as Array<HookType>) {
                this.register(data, ret, v);
            }
        }
        console.log(`create hook operator ${ctor.name}, description: ${ret.getDescription()}`);
        return ret;
    }

    public static destroyImp<T extends IHookOperator>(data: HookData, ctor: Constructor<T>): boolean {
        let op = data.ctorToOp.get(ctor);
        if (!op) return false;

        let hookType = op.getHookType();
        if (typeof hookType === "number") {
            this.unregister(data, op, hookType);
        } else {
            for (let v of hookType as Array<HookType>) {
                this.unregister(data, op, v);
            }
        }

        data.ctorToOp.delete(ctor);
        return true;
    }

    public static register(data: HookData, hookOperator: IHookOperator, hookType: HookType) {
        assert(hookOperator);
        let hookOperators = data.opInfos[hookType] || new Array<HookOperatorBase>();
        assert(hookOperators.indexOf(hookOperator) === -1, "Register hookOperator duplicated");
        hookOperators.push(hookOperator);
        data.opInfos[hookType] = hookOperators;
    }

    public static unregister(data: HookData, hookOperator: IHookOperator, hookType: HookType) {
        let hookOperators = data.opInfos[hookType];
        let index = hookOperators?.indexOf(hookOperator);
        if (index !== undefined && index >= 0) {
            hookOperators?.splice(index, 1);
        }
    }
}

HookUtil.triggerHook = HookUtilImp.triggerHook;
HookUtil.get = HookUtilImp.get;
HookUtil.create = HookUtilImp.create;
HookUtil.destroy = HookUtilImp.destroy;

export * from "./HookDefine";
