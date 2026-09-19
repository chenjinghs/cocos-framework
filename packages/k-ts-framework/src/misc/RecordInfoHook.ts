

import { Action, StoreAction } from "../framework/Action.js";
import { Event, StoreEvent } from "../framework/Event.js";
import { CallbackType } from "../framework/Interface.js";
import { Store, StoreProxy } from "../framework/Store.js";
import { System } from "../framework/System.js";
import { stacktrace } from "../global/GlobalFunctions.js";
import { HookOperatorBase, HookProcessor, HookType, HookUtil } from "./HookUtilImpl.js";
import { SubscribeHook } from "./SubscribeHook.js";
import { SubscribeInstanceInfo } from "./Subscriber.js";

export class RecordInfoNode {
    public info: string;
    public subSteps?: Array<RecordInfoNode>;

    public constructor(info: string) {
        this.info = info;
    }
}

// 临时这么搞，info的格式还没定，后面有需求在细化
export class RecordInfoHook extends HookOperatorBase {
    private stack = new Array<RecordInfoNode>();
    private recordRootNodes = new Array<RecordInfoNode>();

    public constructor() {
        super();

        HookUtil.get(SubscribeHook).setSubscriberCallbackHook(
            (info: SubscribeInstanceInfo, callback: CallbackType | undefined, thisArg: any, description?: string) => {
                return (...args: any[]) => {
                    this.pushInfo(`Subscriber [${description || stacktrace()}] call`);
                    let ret = callback?.call(thisArg, ...args);
                    this.popInfo();
                    return ret;
                };
            },
        );
    }

    /**
     * System创建后被调用
     * @param system System
     * @param subscribeHelper System使用的订阅帮助类
     */
    public onSystemPostCreate(system: System) {
        this.pushInfo(`System [${system.constructor.name}] created`);
    }

    /**
     * System postInit后被调用
     * @param system System
     * @param subscribeHelper System使用的订阅帮助类
     */
    public onSystemPostInit(_system: System) {
        this.popInfo();
    }

    /**
     * System删除前调用
     * @param system System
     * @param subscribeHelper System使用的订阅帮助类
     */
    public onSystemPreDestroy(system: System) {
        this.pushInfo(`System [${system.constructor.name}] destroyed`);
    }

    /**
     * System删除后调用
     * @param system System
     * @param subscribeHelper System使用的订阅帮助类
     */
    public onSystemPostDestroy(_system: System) {
        this.popInfo();
    }

    /**
     * Store创建后调用
     * @param store Store
     * @param proxy Store代理，可对Store进行替换或者包装
     */
    public onStorePostCreate(_store: Store, _proxy: StoreProxy) {
        this.pushInfo(`Store [${_store.constructor.name}] created`, false);
    }

    /**
     * Store删除前调用
     * @param store Store
     */
    public onStorePreDestroy(_store: Store) {
        this.pushInfo(`Store [${_store.constructor.name}] destroyed`, false);
    }

    /**
     * Store修改前调用
     * @param store Store
     */
    public onStorePreModify(_store: Store) {
        this.pushInfo(`Store [${_store.constructor.name}] modified`);
    }

    /**
     * Store修改后调用
     * @param store Store
     * @param changed 是否成功修改（modify函数返回值）
     */
    public onStorePostModify(_store: Store, _changed: boolean) {
        this.popInfo();
    }

    /**
     * Action执行前调用
     * @param action Action
     */
    public onActionPreDo(_action: Action<unknown>, _processor: HookProcessor) {
        this.pushInfo(`Action [${_action.constructor.name}] do`);
    }

    /**
     * Action执行后调用
     * @param action Action
     * @package result Action执行完结果
     */
    public onActionPostDo(_action: Action<unknown>, _result: unknown) {
        this.popInfo();
    }

    /**
     * Event执行前调用
     * @param event Event
     */
    public onEventPreDispatch(_event: Event, _processor: HookProcessor) {
        this.pushInfo(`Event [${_event.constructor.name}] dispatch`);
    }

    /**
     * Event执行后调用
     * @param event Event
     */
    public onEventPostDispatch(_event: Event) {
        this.popInfo();
    }

    /**
     * StoreAction执行前调用
     * @param action StoreAction
     */
    public onStoreActionPreDo(action: StoreAction<unknown>, store: Readonly<Store>, _doWrapper: HookProcessor) {
        this.pushInfo(`StoreAction [${action.constructor.name}] do, store: [${store.constructor.name}]`);
    }

    /**
     * StoreAction执行后调用
     * @param action StoreAction
     * @param result StoreAction执行完结果
     */
    public onStoreActionPostDo(_action: StoreAction<unknown>, _store: Readonly<Store>, _result: unknown) {
        this.popInfo();
    }

    /**
     * StoreEvent执行前调用
     * @param event StoreEvent
     */
    public onStoreEventPreDispatch(_event: StoreEvent, _store: Readonly<Store>, _dispatchWrapper: HookProcessor) {
        this.pushInfo(`StoreEvent [${_event.constructor.name}] dispatch, store: [${_store.constructor.name}]`);
    }

    /**
     * StoreEvent 执行后调用
     * @param event StoreEvent
     */
    public onStoreEventPostDispatch(_event: StoreEvent, _store: Readonly<Store>) {
        this.popInfo();
    }

    /**
     * UtilLinker 调用前调用
     */
    public onUtilLinkerPreCall(system: System, _funcName: string, ..._args: any[]) {
        this.pushInfo(`UtilLinker [${system.constructor.name}] [${_funcName}] call`);
    }

    /**
     * UtilLinker 调用后调用
     */
    public onUtilLinkerPostCall(_system: System, _funcName: string, _ret: unknown, ..._args: any[]) {
        this.popInfo();
    }

    public getDescription(): string {
        return "record info";
    }

    public getHookType(): HookType | HookType[] {
        return [
            HookType.onSystemPostCreate,
            HookType.onSystemPostInit,
            HookType.onSystemPreDestroy,
            HookType.onSystemPostDestroy,
            HookType.onStorePostCreate,
            HookType.onStorePreDestroy,
            HookType.onStorePreModify,
            HookType.onStorePostModify,
            HookType.onActionPreDo,
            HookType.onActionPostDo,
            HookType.onEventPreDispatch,
            HookType.onEventPostDispatch,
            HookType.onStoreActionPreDo,
            HookType.onStoreActionPostDo,
            HookType.onStoreEventPreDispatch,
            HookType.onStoreEventPostDispatch,
            HookType.onUtilLinkerPreCall,
            HookType.onUtilLinkerPostCall,
        ];
    }

    public inheritFrom(_source: RecordInfoHook) {}

    public getNodes() {
        return this.recordRootNodes;
    }

    private pushInfo(info: string, pushToStack?: boolean) {
        let node = new RecordInfoNode(info);
        if (this.stack.length === 0) {
            this.recordRootNodes.push(node);
        }

        let top =
            this.stack.length > 0
                ? this.stack[this.stack.length - 1]
                : this.recordRootNodes[this.recordRootNodes.length - 1];
        if (top !== node) {
            if (!top.subSteps) top.subSteps = new Array<RecordInfoNode>();
            top.subSteps.push(node);
        }

        if (pushToStack !== false) {
            this.stack.push(node);
        }
    }

    private popInfo() {
        this.stack.pop();
    }
}