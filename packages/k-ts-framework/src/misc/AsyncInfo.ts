import { Env } from "../framework/Env";
import { IEnvData, IStartAsyncExtraOutput, IStartAsyncParams, ISubscribeHelper } from "../framework/Interface";
import { assert, getStackTraceInfo, getStackTraceInfoString, IStackTraceInfo } from "../global/GlobalFunctions";

export const INVALID_ASYNC_HANDLE = Symbol("InvalidAsyncHandle");

let ENABLE_ASYNC_DEBUG_LOG = false;
const NEW_PROMISE_HANDLE_NAME = "NewPromiseHandle";
const ASYNC_HANDLE_NAME = "AsyncHandle";
// const ASYNC_GROUP_HANDLE_NAME = "AsyncGroupHandle";

const CANCEL_ASYNC_CHAIN_REASON = "_CancelAsyncChain_";
const CANCEL_ASYNC_CHAIN_REASON_OPTIONS = {
    cause: CANCEL_ASYNC_CHAIN_REASON,
};

const DEFER_ERROR_WITH_PARENT_CHECK_REASON = "_DeferErrorWithParentCheck_";
const DEFER_ERROR_WITH_PARENT_CHECK_REASON_OPTIONS = {
    cause: DEFER_ERROR_WITH_PARENT_CHECK_REASON,
};

const CANCELED_HANDLE = Symbol("CANCELED_HANDLE");
const FINISHED_HANDLE = Symbol("FINISHED_HANDLE");

enum EParentAsyncChainValidState {
    AllValid = 0,
    HasInvalid,
    AllInvalid,
}

enum EPromisePhase {
    Start = 0,
    Then,
    Catch,
    Finally,
    PostFinallyCallback,
    NewPromise,
    NewPromiseFinally,
}

export interface IOwnerWithAsyncInfos extends ISubscribeHelper {
    asyncInfos?: Map<symbol, AsyncInfo>;
}

export abstract class AsyncInfo {
    public rootHandle?: symbol;
    public rootPromise!: Promise<unknown>;
    public rootReject?: (reason: any) => void;
    public description!: IStackTraceInfo;
    public owner: IOwnerWithAsyncInfos;

    public parentAsyncInfo?: AsyncInfo;
    public childAsyncInfos?: AsyncInfo[];

    public get valid(): boolean {
        return this.rootHandle !== undefined && this.rootHandle !== CANCELED_HANDLE && this.rootHandle !== FINISHED_HANDLE;
    }
    public constructor(owner: ISubscribeHelper) {
        this.owner = owner;
    }

    public abstract add(promiseHandle: symbol, promise: Promise<unknown>): void;
    public abstract remove(promiseHandle: symbol): void;
    public abstract getAllHandles(): symbol[];

    public setCanceled() {
        this.rootHandle = CANCELED_HANDLE;
    }
    public setFinished() {
        this.rootHandle = FINISHED_HANDLE;
    }
    public isCanceled() {
        return this.rootHandle === CANCELED_HANDLE;
    }
    public isFinished() {
        return this.rootHandle === FINISHED_HANDLE;
    }
}

class SinglePromiseAsyncInfo extends AsyncInfo {
    public handle?: symbol;
    public promise?: Promise<unknown>;

    public add(handle: symbol, promise: Promise<unknown>): void {
        assert(this.handle === undefined, `last promise has not been resolved.`);
        this.handle = handle;
        this.promise = promise;
    }
    public remove(handle: symbol): void {
        assert(this.handle === handle, `current resolved promise is not valid.`);
        this.handle = undefined;
        this.promise = undefined;
    }
    public getAllHandles() {
        return this.handle ? [this.handle] : [];
    }
}

class MultiPromiseAsyncInfo extends AsyncInfo {
    public promises = new Map<symbol, Promise<unknown>>();
    public add(handle: symbol, promise: Promise<unknown>): void {
        assert(!this.promises.has(handle), `duplicated promise added.`);
        this.promises.set(handle, promise);
    }
    public remove(handle: symbol): void {
        let ret = this.promises.delete(handle);
        assert(ret, `remove promise failed`);
    }
    public getAllHandles() {
        return [...this.promises.keys()];
    }
}

class AsyncInfoData implements IEnvData {
    public currentAsyncHandle?: symbol;
    public allHandleToInfo = new Map<symbol, AsyncInfo>();

    public inheritFrom(_: AsyncInfoData): void {}
}

// ////////////////////////////////////////////////////////////////////////////////////////////////////
export function getCurrentAsyncInfo(): AsyncInfo | undefined {
    let data = Env.getCurrentData(AsyncInfoData);
    return data.currentAsyncHandle ? data.allHandleToInfo.get(data.currentAsyncHandle) : undefined;
}

export function deferErrorWithParentCheck(info: string): never {
    throw new Error(info, DEFER_ERROR_WITH_PARENT_CHECK_REASON_OPTIONS);
}

export function setAsyncDebugLogEnabled(enable: boolean) {
    ENABLE_ASYNC_DEBUG_LOG = enable;
}

export function createAsyncInfo(owner: IOwnerWithAsyncInfos, params: IStartAsyncParams, output?: IStartAsyncExtraOutput): symbol | undefined {
    let data = Env.getCurrentData(AsyncInfoData);
    let parentInfo = params.parentAsyncHandle ? findAsyncInfo(data, params.parentAsyncHandle) : undefined;
    if (parentInfo) checkAsyncChainValidState(parentInfo, EPromisePhase.Start, true);

    let info = createAsyncHandle(data, owner, parentInfo, params.canRunMultiPromiseAtOneTime, params.description);
    let asyncHandle = info.rootHandle;

    // 这个必须在getParentAsyncInfo后调用
    setCurrentAsyncInfo(data, asyncHandle!);

    let resolveResult: any;
    let rejectReason: any;
    let checkFinally = true;

    info.rootPromise = new Promise((resolve, reject) => {
        info.rootReject = reject;
        params.callback.call(params.thisArg, asyncHandle!).then(resolve).catch(reject);
    })
        .then((value: unknown) => {
            // 检查异步链是否有效
            let valid = checkAsyncChainValidState(info, EPromisePhase.Then);

            // 没事就往下走
            resolveResult = value;
            onFinishAsync(data, owner, info);

            // 如果有callback则处理
            if (valid && params.resolveCallback) params.resolveCallback.call(params.thisArg, value);

            return value;
        })
        .catch((reason) => {
            rejectReason = reason;
            if (ENABLE_ASYNC_DEBUG_LOG) outputAsyncDebugLog(info, `catch normal cancel, reason: ${String(reason)}, error: ${reason}`);

            if (reason?.cause === CANCEL_ASYNC_CHAIN_REASON) {
                // 取消异步链
                checkFinally = false;

                // @TODO: 这里有个问题，如果以下面形式调用
                // let t1 = asyncTest1()
                // let t2 = await asyncTest2();
                // await t1;
                // 当t1和t2都cancel时，那么t1的error父链收不到，然后会报异常
                // 这里没处理是因为这种写法很少见，而且如果t2挂了，t1也属于一个未知状态，所以遇到了这个换个写法
                // PS: 实在不行就只能重载puer.on，去兜底忽略这个error

                // 自己无效，如果有parent无脑往上抛
                if (info.parentAsyncInfo) throw reason;
                // 自己无效，且没有parent，那么就不抛异常，直接返回
                else return;
            } else if (reason?.cause === DEFER_ERROR_WITH_PARENT_CHECK_REASON) {
                // 延迟检查
                checkFinally = false;

                // 检查异步链
                let valid = checkAsyncChainValidState(info, EPromisePhase.NewPromise);

                // 如果异步链有效，则说明不该抛这个异常，所以这里error掉
                if (valid) rejectReason = new Error(reason.message);
                // 如果都无效，说明异步链已经被销毁，此时无需处理
                else return;
            }

            // 最后是错误处理
            if (info.valid && params.rejectCallback) params.rejectCallback.call(params.thisArg, rejectReason);
            else if (params.throwRejectError !== false) throw rejectReason;
        })
        .finally(() => {
            deleteAsyncHandle(data, owner, asyncHandle!);

            // finally执行后会同步执行后面的代码，所以在执行代码前这是最后的检查
            let valid = checkFinally && checkAsyncChainValidState(info, EPromisePhase.Finally);

            if (valid && params.finallyCallback) {
                params.finallyCallback(asyncHandle!, resolveResult, rejectReason);

                // 如果有callback还得来一次，因为有可能在callback内删掉async，那么后面的都不需要执行了
                checkAsyncChainValidState(info, EPromisePhase.PostFinallyCallback, true);
            }
        });

    if (output) output.rootPromise = info.rootPromise;
    return owner.asyncInfos?.has(asyncHandle!) ? asyncHandle : undefined;
}

export function cancelAsyncInfo(owner: IOwnerWithAsyncInfos, asyncHandle: symbol) {
    let info = owner.asyncInfos?.get(asyncHandle);
    if (info === undefined) return;

    unsubscribeAsyncInfo(info);

    if (info.childAsyncInfos) {
        // 销毁所有子
        for (let v of info.childAsyncInfos) {
            if (v.owner.asyncInfos) v.owner.cancelAsync(v.rootHandle!);
        }
        info.childAsyncInfos = undefined;
    }
    if (info.parentAsyncInfo && info.parentAsyncInfo.valid) {
        // 如果parent还在，但自己销毁了，那么延迟判parent有效性，因为有可能parent也在销毁过程中
        // 延迟判断时如果parent销毁了，那么就不会抛异常，否则会抛异常
        Promise.resolve().then(() => {
            checkAsyncChain(info, false);
        });
    }

    deleteAsyncHandle(Env.getCurrentData(AsyncInfoData), owner, asyncHandle);
    info.setCanceled();

    if (ENABLE_ASYNC_DEBUG_LOG) outputAsyncDebugLog(info, `setCanceled`);
}

export function cancelAllAsyncInfos(owner: IOwnerWithAsyncInfos) {
    if (!owner.asyncInfos) return;

    let handles = owner.asyncInfos.keys();
    for (let handle of handles) {
        cancelAsyncInfo(owner, handle);
    }
}

export function createPromiseInfo(
    owner: IOwnerWithAsyncInfos,
    asyncHandle: symbol,
): {
    promise: Promise<any>;
    resolve: (value: unknown) => void;
    handle: symbol;
} {
    let info = findAsyncInfoWithOwner(owner, asyncHandle);
    if (!info) {
        // 自己没了，这里有两种可能，一种是parent都没了，那么是正常现象；另一种是parent还在，则应该报错。所以这里只能抛上去让上面决定
        deferErrorWithParentCheck(`new promise failed, the async request is invalid`);
    } else {
        checkAsyncChainValidState(info, EPromisePhase.NewPromise);
    }

    let data = Env.getCurrentData(AsyncInfoData);
    let savedResolve: (value: unknown) => void;
    let savedReject: (value: unknown) => void;
    let promiseHandle = Symbol(NEW_PROMISE_HANDLE_NAME);
    let promise = new Promise((resolve, reject) => {
        savedResolve = resolve;
        savedReject = reject;
    })
        .catch((e) => {
            // 这里catch是为了避免promise报错
            // 这里的catch会在finally之前执行，所以如果有finally的话，先执行finally
            if (ENABLE_ASYNC_DEBUG_LOG) outputAsyncDebugLog(info, `catch promise, error: ${String(e)}`);
        })
        .finally(() => {
            checkAsyncChainValidState(info, EPromisePhase.NewPromiseFinally);
        });
    info.add(promiseHandle, promise);

    // 新的resolve函数会判断handle是否有效，无效就会直接reject
    let newResolve = (value: unknown) => {
        let foundInfo = findAsyncInfoWithOwner(owner, asyncHandle!);
        if (foundInfo !== undefined) {
            setCurrentAsyncInfo(data, asyncHandle);

            // 将当前promise handle解绑
            foundInfo.remove(promiseHandle);
            owner.unsubscribeWithHandle(promiseHandle);

            // 检查父级是否有效
            checkAsyncChain(info, true);

            // 调用真正的resolve
            if (ENABLE_ASYNC_DEBUG_LOG) outputAsyncDebugLog(info, `resolve`);
            savedResolve!(value);
        } else {
            // 不该走到这里，因为如果取消订阅后，callback不会掉回来才对
            const log = `[Async] new promise failed, the async request is invalid, desc: ${getStackTraceInfoString(info.description)}`;
            console.warn(log);
            savedReject!(log);
        }
    };

    return {
        promise,
        resolve: newResolve,
        handle: promiseHandle,
    };
}

export function cancelAsyncChainIfAllParentsDestroyed(parentAsyncHandle: symbol, info: string) {
    let data = Env.getCurrentData(AsyncInfoData);
    let parentInfo = data.allHandleToInfo.get(parentAsyncHandle);

    if (parentInfo && EParentAsyncChainValidState.AllInvalid !== collectParentAsyncChainValidState(parentInfo)) {
        return;
    }

    // 如果parentInfo无效，那么就直接取消
    console.log(info);
    cancelAsyncChain(info);
}

// ////////////////////////////////////////////////////////////////////////////////////////////////////
function setCurrentAsyncInfo(data: AsyncInfoData, handle: symbol) {
    data.currentAsyncHandle = handle;
}

function clearCurrentAsyncInfo(data: AsyncInfoData, handle: symbol) {
    if (data.currentAsyncHandle === handle) {
        data.currentAsyncHandle = undefined;
    }
}

function collectParentAsyncChainValidState(info: AsyncInfo | undefined) {
    if (!info) return EParentAsyncChainValidState.AllInvalid;

    // 如果当前info是结束状态，那么往前找找到最近的非结束状态的info
    let tempInfo: AsyncInfo | undefined = info;
    while (tempInfo && tempInfo.isFinished()) tempInfo = tempInfo.parentAsyncInfo;

    // 如果都结束了那么整条链认为有效
    if (!tempInfo) return EParentAsyncChainValidState.AllValid;

    // 查找父链上的无效状态
    let rootInfo = tempInfo;
    let invalidInfo;
    while (tempInfo) {
        rootInfo = tempInfo;
        if (!invalidInfo && !tempInfo.valid) invalidInfo = info;
        tempInfo = tempInfo.parentAsyncInfo;
    }

    // 根异步销毁了，那么所有子都属于销毁状态
    if (!rootInfo!.valid) return EParentAsyncChainValidState.AllInvalid;
    // 根异步有效，但调用栈有无效的
    else if (invalidInfo) return EParentAsyncChainValidState.HasInvalid;
    // 都有效
    else return EParentAsyncChainValidState.AllValid;
}

function findAsyncInfo(data: AsyncInfoData, handle: symbol) {
    return data.allHandleToInfo.get(handle);
}

function cancelAsyncChain(info: string): never {
    throw new Error(info, CANCEL_ASYNC_CHAIN_REASON_OPTIONS);
}

function outputAsyncDebugLog(info: AsyncInfo, log: string) {
    console.log(`[AsyncDebug] log: ${log}, async info desc: ${getStackTraceInfoString(info.description)}`);
}

function checkAsyncChainValidState(info: AsyncInfo, phase: EPromisePhase, forceThrowCancelRequest: boolean = false) {
    const state = collectParentAsyncChainValidState(info);
    if (ENABLE_ASYNC_DEBUG_LOG) outputAsyncDebugLog(info, `checkAsyncChainValidState phase ${EPromisePhase[phase]}, state: ${EParentAsyncChainValidState[state]}`);

    switch (state) {
        case EParentAsyncChainValidState.AllInvalid:
            if (info.parentAsyncInfo || forceThrowCancelRequest)
                cancelAsyncChain(`[Async] cancelAsyncChain, phase ${EPromisePhase[phase]}, state: ${EParentAsyncChainValidState[state]}, desc: ${getStackTraceInfoString(info.description)}`);
            else return false;
            break;
        case EParentAsyncChainValidState.HasInvalid:
            throw new Error(`[Async] error, phase ${EPromisePhase[phase]}, state: ${EParentAsyncChainValidState[state]}, desc: ${getStackTraceInfoString(info.description)}`);
    }
    return true;
}

function createAsyncHandle(data: AsyncInfoData, owner: IOwnerWithAsyncInfos, parentInfo?: AsyncInfo, canRunMultiPromiseAtOneTime?: boolean, description?: IStackTraceInfo) {
    let asyncHandle: symbol | undefined = Symbol(ASYNC_HANDLE_NAME);
    let info = canRunMultiPromiseAtOneTime ? new MultiPromiseAsyncInfo(owner) : new SinglePromiseAsyncInfo(owner);

    assert(owner.asyncInfos);
    owner.asyncInfos.set(asyncHandle, info);
    data.allHandleToInfo.set(asyncHandle, info);

    info.rootHandle = asyncHandle;
    info.description = description || getStackTraceInfo();

    info.parentAsyncInfo = parentInfo;
    if (parentInfo) {
        parentInfo.childAsyncInfos = parentInfo.childAsyncInfos || [];
        parentInfo.childAsyncInfos.push(info);
    }

    return info;
}

function onFinishAsync(data: AsyncInfoData, owner: IOwnerWithAsyncInfos, info: AsyncInfo) {
    // 这里特意没处理子，是因为如果子还有效，那么在子的then中会抛异常
    unsubscribeAsyncInfo(info);
    deleteAsyncHandle(data, owner, info.rootHandle!);
    info.setFinished();
}

function unsubscribeAsyncInfo(info: AsyncInfo) {
    if (info instanceof SinglePromiseAsyncInfo) {
        if (info.handle) {
            info.owner.unsubscribeWithHandle(info.handle);
        }
    } else {
        const minfo = info as MultiPromiseAsyncInfo;
        for (let v of minfo.promises.keys()) {
            info.owner.unsubscribeWithHandle(v);
        }
    }
}

function deleteAsyncHandle(data: AsyncInfoData, owner: IOwnerWithAsyncInfos, asyncHandle: symbol) {
    data.allHandleToInfo.delete(asyncHandle);
    clearCurrentAsyncInfo(data, asyncHandle);

    if (!owner.asyncInfos) return;

    let info = owner.asyncInfos.get(asyncHandle);
    if (info) owner.asyncInfos.delete(asyncHandle);
    return info;
}

function checkAsyncChain(info: AsyncInfo, valid: boolean) {
    let parentInfo = info.parentAsyncInfo;
    while (parentInfo) {
        assert(
            parentInfo.valid === valid,
            `check async chain failed, parent async is ${valid ? "not valid" : "still valid"}, \nself: ${getStackTraceInfoString(info.description)}, \nparent: ${getStackTraceInfoString(
                parentInfo.description,
            )}`,
        );
        parentInfo = parentInfo.parentAsyncInfo;
    }
}

function findAsyncInfoWithOwner(owner: IOwnerWithAsyncInfos, handle: symbol, checkValid = true) {
    if (owner.asyncInfos === undefined) return undefined;

    let ret = owner.asyncInfos.get(handle);
    if (checkValid && ret && !ret.valid) return undefined;
    else return ret;
}

// public startAsyncGroup(
//     operator: EAsyncGroupOperator,
//     handles: symbol | symbol[],
//     finishCallback?: () => void,
//     thisArg?: ISystem,
//     description?: string,
// ): symbol {
//     let asyncHandle = Symbol(ASYNC_GROUP_HANDLE_NAME);
//     let newInfo = new SinglePromiseAsyncInfo();
//     newInfo.rootHandle = asyncHandle;

//     let allInfos = this.verifyAsyncInfos();
//     allInfos.set(asyncHandle, newInfo);

//     let promises = [];
//     let info;
//     if (Array.isArray(handles)) {
//         for (const v of handles) {
//             info = allInfos.get(v);
//             if (info?.rootPromise !== undefined) promises.push(info.rootPromise);
//         }
//     } else {
//         info = allInfos.get(handles);
//         if (info?.rootPromise !== undefined) promises.push(info.rootPromise);
//     }

//     let resultPromise;
//     switch (operator) {
//         case EAsyncGroupOperator.All:
//             resultPromise = Promise.all(promises).then(() => {
//                 this.onFinishAsync(asyncHandle, undefined, finishCallback, thisArg);
//             });
//             break;
//         case EAsyncGroupOperator.Any:
//             resultPromise = Promise.any(promises).then(() => {
//                 this.onFinishAsync(asyncHandle, undefined, finishCallback, thisArg);
//             });
//             break;
//         default:
//             assert(false, `start async group failed, operator ${operator} is not supported`);
//     }

//     newInfo.description = description || getDebugStackTrace(0, 10);
//     newInfo.rootPromise = resultPromise;

//     return asyncHandle;
// }

//   public multiPromise(asyncHandle: symbol, promises: Array<Promise<unknown>>, operator: EMultiPromiseOperator): Promise<unknown> {
//         let info = this.findSelfAsyncInfo(asyncHandle);
//         assert(info !== undefined, `multiPromise failed, the async request is invalid`);
//         assert(info instanceof MultiPromiseAsyncInfo, `multiPromise failed, the async group must enable canRunMultiPromiseAtOneTime.`);
//         this.setCurrentAsyncInfo(asyncHandle);

//         let savedPromises = new Set(info.promises.values());
//         for (let v of promises) {
//             assert(savedPromises.has(v), `multiPromise failed, the input promise ${v} is not in current async group`);
//         }

//         let retPromise;
//         switch (operator) {
//             case EMultiPromiseOperator.All:
//                 retPromise = Promise.all(promises);
//                 break;
//             case EMultiPromiseOperator.Any:
//                 retPromise = Promise.any(promises);
//                 break;
//             case EMultiPromiseOperator.AllSettled:
//                 retPromise = Promise.allSettled(promises);
//                 break;
//             case EMultiPromiseOperator.Race:
//                 retPromise = Promise.race(promises);
//                 break;
//             default:
//                 assert(false, `invalid multi promise operator type ${operator}`);
//         }

//         retPromise.finally(() => {
//             this.clearCurrentAsyncInfo(asyncHandle);
//         });
//         return retPromise;
//     }
