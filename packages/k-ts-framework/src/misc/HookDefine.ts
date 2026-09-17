/* eslint-disable @typescript-eslint/method-signature-style */
import { IEnvData } from "../framework/Interface";

export enum HookType {
    onStoreRegister = 0,
    onSystemRegister,

    onSystemVerifyTag,
    onSystemPostCreate,
    onSystemPreInit,
    onSystemPostInit,
    onSystemPreDestroy,
    onSystemPostDestroy,

    onStoreVerifyTag,
    onStorePostCreate,
    // onStorePostUpdate,
    onStorePreDestroy,

    onStorePreModify,
    onStorePostModify,

    onActionPreDo,
    onActionPostDo,

    onEventPreDispatch,
    onEventPostDispatch,

    onStoreActionPreDo,
    onStoreActionPostDo,

    onStoreEventPreDispatch,
    onStoreEventPostDispatch,

    onUtilLinkerPreCall,
    onUtilLinkerPostCall,
}

export interface IHookOperator extends IEnvData {
    /**
     * 获取描述信息
     * @return 信息
     */
    getDescription(): string;

    /**
     * 获取Hook类型
     * @return Hook类型
     */
    getHookType(): HookType | HookType[];
}

type Constructor<T> = new (...args: any[]) => T;
export type VerifyGetReturn<TReturn, TCreate> = TCreate extends false ? TReturn | undefined : TReturn;

// 这么拆为了防止循环引用
export class HookUtil {
    /**
     * 触发Hook
     */
    public static triggerHook: (hookType: HookType, ...args: any[]) => void;

    /**
     * 根据Type获取Operator
     * @param createIfNotExisted 如果没有则创建，不填则默认创建
     */
    public static get: <T extends IHookOperator, TCreate extends boolean = true>(ctor: Constructor<T>, createIfNotExists?: TCreate) => VerifyGetReturn<T, TCreate>;

    /**
     * 创建Operator
     */
    public static create: <T extends IHookOperator>(ctor: Constructor<T>) => void;

    /**
     * 销毁Operator
     */
    public static destroy: <T extends IHookOperator>(ctor: Constructor<T>) => boolean;
}

/**
 * 分发Action和Event时可以替换具体分发函数
 */
export class HookProcessor {
    public processed = false;
    public result?: unknown;

    public reset() {
        this.processed = false;
        this.result = undefined;
    }

    public setProcessed(result?: unknown) {
        this.processed = true;
        this.result = result;
    }
}
