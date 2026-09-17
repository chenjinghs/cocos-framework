import { safeStringify } from "json-util";
import { D, F } from "k-ts-framework";

import { EWndState, RUIStore, UI_SYSTEM_TAG, UIResType, UIRootStore, UIStore, UITagType, WndDataStore } from "./Define";
import { UIEngineInterface } from "./EngineInterface";
import * as AE from "./PublicAE";
import { createPrefabAsync, openWndAsync } from "./SubscriberExtension";
import { UILogger } from "./UILogger";
import * as Util from "./Util";

const MAX_SUB_ORDER = 99;
const LOAD_WND_RES_PENDING_TASK_HANDLE = Symbol("LoadWndRes");
class OnPendingWndTaskResolvedEvent extends F.Event {}

@D.system(UI_SYSTEM_TAG, [UIRootStore, UIStore, WndDataStore])
class UISystem extends F.System {
    @D.linkUtil(Util.openWnd)
    protected openWnd(uiTag: UITagType, params?: unknown, overrideLayer?: number) {
        let lastWndData = UIRootStore.getSingleton().wnds.get(uiTag);
        if (lastWndData && lastWndData?.wndState <= EWndState.Opened) this.closeWnd(uiTag, undefined, true);
        if (lastWndData && lastWndData.wndState === EWndState.Closing) {
            UILogger.w(uiTag, `openWnd, wnd is closing, pending open on closed`);
            this.modify(lastWndData, (v) => (v.pendingOpenOnClosed = { params, overrideLayer }));
            return;
        }

        const { uiStore, wndData } = this.createWnd(uiTag);
        const sortingOrder = this.increaseOrderInLayer(uiStore, overrideLayer);
        this.modify(wndData, (v) => ((v.wndState = EWndState.Opening), (v.sortingOrder = sortingOrder)));
        UILogger.i(uiTag, `openWnd, sortingOrder: ${sortingOrder}, params: ${safeStringify(params)}`);

        this.startAsync(this.openWndImpl, this, [uiStore, wndData, params]);
    }

    @D.linkUtil(openWndAsync)
    protected openWndAsync(uiTag: UITagType, params?: unknown, overrideLayer?: number, callback?: () => void): { cancel: () => void } {
        let shell: { handle: symbol | undefined; cancel: () => void } = { handle: undefined, cancel: () => shell.handle && this.cancelAsync(shell.handle) && this.closeWnd(uiTag) };
        this.startAsync(async (handle: symbol) => {
            shell.handle = handle;
            this.openWnd(uiTag, params, overrideLayer);
            while (!Util.isWndOpened(uiTag)) await this.newPromise<AE.OnWndOpenedEvent>(handle, AE.OnWndOpenedEvent);
            shell.handle = undefined;
            callback?.();
        });
        return shell;
    }

    private async openWndImpl(handle: symbol, uiStore: RUIStore, wndData: Readonly<WndDataStore>, params?: unknown) {
        this.modify(wndData, (v) => ((v.openAsyncHandle = handle), (v.pendingHandles = new Set())));
        iterChildrenAE(AE.OnWndPreOpenSAction, uiStore, params);
        if (wndData.wndState !== EWndState.Opening) return; // 有可能在 PreOpen 就给关了
        this.registerWndPendingTaskImpl(wndData, LOAD_WND_RES_PENDING_TASK_HANDLE);
        this.loadUIRes(uiStore, undefined, params, () => this.resolveWndPendingTaskImpl(wndData, LOAD_WND_RES_PENDING_TASK_HANDLE));
        while (wndData.pendingHandles?.size) await this.newPromise(handle, OnPendingWndTaskResolvedEvent);
        if (wndData.wndState !== EWndState.Opening) return; // 防止 promise 跳帧，然后窗口已经关闭
        this.modify(wndData, (v) => ((v.openAsyncHandle = undefined), (v.pendingHandles = undefined)));

        this.pushWndStack(uiStore);
        UIEngineInterface._addToScreen(uiStore, wndData.sortingOrder);
        this.modify(wndData, (v) => (v.wndState = EWndState.Opened));

        iterChildrenAE(AE.OnWndOpenedSEvent, uiStore, params);
        safeExec(uiStore.uiTag, () => AE.OnWndOpenedEvent.dispatch(uiStore.uiTag, params));
        UILogger.i(uiStore.uiTag, `openWnd finished`);
    }

    @D.linkUtil(Util.closeWnd)
    protected closeWnd(uiTag: UITagType, params?: unknown, forceClose?: boolean) {
        const uiStore = Util.findWnd(uiTag);
        if (uiStore === undefined) return;

        const wndData = Util.getLogicStore(uiStore, WndDataStore);
        if (wndData === undefined) return;

        if (wndData.pendingOpenOnClosed) {
            UILogger.w(uiTag, `closeWnd, clean pending open data.`);
            this.modify(wndData, (v) => (v.pendingOpenOnClosed = undefined));
            return;
        }

        if (wndData.wndState === EWndState.Closed) return;
        if (wndData.wndState === EWndState.Closing && forceClose) {
            UILogger.i(uiTag, `force closeWnd`);
            this.cleanWndPendingTask(wndData);
            return;
        }

        UILogger.i(uiTag, `closeWnd, force: ${forceClose}, wndState: ${EWndState[wndData.wndState]}, params: ${safeStringify(params)}`);
        this.modify(wndData, (v) => (v.wndState = EWndState.Closing));
        this.startAsync(this.closeWndImpl, this, [uiStore, wndData, params, forceClose]);
    }

    private async closeWndImpl(handle: symbol, uiStore: RUIStore, wndData: Readonly<WndDataStore>, params?: unknown, forceClose?: boolean) {
        if (wndData.openAsyncHandle) {
            UILogger.i(uiStore.uiTag, `cancel unfinished openWnd async operation`);
            iterChildrenAE(AE.OnWndAheadCloseSAction, uiStore, params);
            this.cancelAsync(wndData.openAsyncHandle);
            this.modify(wndData, (v) => ((v.openAsyncHandle = undefined), (v.pendingHandles = undefined)));
        } else {
            safeExec(uiStore.uiTag, () => AE.OnWndCloseEvent.dispatch(uiStore.uiTag, params));

            this.modify(wndData, (v) => (v.pendingHandles = new Set()));
            iterChildrenAE(AE.OnWndPreCloseSAction, uiStore, params);
            if (!forceClose) while (wndData.pendingHandles?.size) await this.newPromise(handle, OnPendingWndTaskResolvedEvent);
            this.modify(wndData, (v) => (v.pendingHandles = undefined));

            iterChildrenAE(AE.OnWndCloseSEvent, uiStore, params);
            UIEngineInterface._removeFromScreen(uiStore);
            this.popWndStack(uiStore);
        }
        this.unloadUIRes(uiStore, params, false);
        this.modify(wndData, (v) => (v.wndState = EWndState.Closed));
        UILogger.i(uiStore.uiTag, `closeWnd finished`);

        this.decreaseOrderInLayer(uiStore);
        this.destroyWnd(uiStore);

        if (wndData.pendingOpenOnClosed) {
            UILogger.w(uiStore.uiTag, `openWnd from pending open on closed`);
            const { params, overrideLayer } = wndData.pendingOpenOnClosed;
            this.modify(wndData, (v) => (v.pendingOpenOnClosed = undefined));
            this.openWnd(uiStore.uiTag, params, overrideLayer);
        }
    }

    @D.linkUtil(Util.closeAllWnds)
    protected closeAllWnds(ignoreWnds?: UITagType | UITagType[], ignoreRegexp?: string) {
        UILogger.i("UISystem", `closeAll ignoreWnds: ${ignoreWnds}, regexp: ${ignoreRegexp}`);
        if (ignoreWnds !== undefined) ignoreWnds = Array.isArray(ignoreWnds) ? ignoreWnds : [ignoreWnds];
        const wnds = UIRootStore.getSingleton().wnds;
        const reg = ignoreRegexp ? new RegExp(ignoreRegexp) : undefined;
        Array.from(wnds.keys()).forEach((wndTag) => {
            if (ignoreWnds?.includes(wndTag)) return;
            if (reg?.test(wndTag)) return;
            this.closeWnd(wndTag);
        });
        UILogger.i("UISystem", `closeAllWnds finished`);
    }

    @D.linkUtil(Util.registerWndPendingTask)
    protected registerWndPendingTask(uiTag: UITagType, taskHandle: symbol) {
        const uiStore = Util.findWnd(uiTag);
        const wndData = uiStore && Util.getLogicStore(uiStore, WndDataStore);
        F.assert(wndData?.pendingHandles, `registerWndPendingTask failed, wnd is not in async state.`);
        this.registerWndPendingTaskImpl(wndData, taskHandle);
    }

    private registerWndPendingTaskImpl(wndData: Readonly<WndDataStore>, taskHandle: symbol) {
        UILogger.i(F.getStoreParent<RUIStore>(wndData).uiTag, `registerWndPendingTask, handle: ${taskHandle.toString()}`);
        this.modify(wndData, (v) => v.pendingHandles?.add(taskHandle));
    }

    @D.linkUtil(Util.resolveWndPendingTask)
    protected resolveWndPendingTask(uiTag: UITagType, taskHandle: symbol): boolean {
        const uiStore = Util.findWnd(uiTag);
        const wndData = uiStore && Util.getLogicStore(uiStore, WndDataStore);
        if (wndData === undefined) return false;
        return this.resolveWndPendingTaskImpl(wndData, taskHandle);
    }

    private resolveWndPendingTaskImpl(wndData: Readonly<WndDataStore>, taskHandle: symbol) {
        if (wndData.pendingHandles?.has(taskHandle) !== true) return false;
        this.modify(wndData, (v) => v.pendingHandles?.delete(taskHandle));
        UILogger.i(F.getStoreParent<RUIStore>(wndData).uiTag, `resolveWndPendingTask, handle: ${taskHandle.toString()}`);
        if (wndData.pendingHandles.size === 0) OnPendingWndTaskResolvedEvent.dispatch();
        return true;
    }

    private cleanWndPendingTask(wndData: Readonly<WndDataStore>) {
        if (wndData.pendingHandles === undefined) return;
        wndData.pendingHandles.clear();
        OnPendingWndTaskResolvedEvent.dispatch();
    }

    @D.linkUtil(Util.isValidWndPendingTask)
    protected isValidWndPendingTask(uiTag: UITagType, handle: symbol) {
        const uiStore = Util.findWnd(uiTag);
        const wndData = uiStore && Util.getLogicStore(uiStore, WndDataStore);
        return wndData?.pendingHandles?.has(handle) === true;
    }

    @D.linkUtil(Util.modifyWndLayer)
    protected modifyWndLayer(uiTag: UITagType, layer: number) {
        const uiStore = Util.findWnd(uiTag);
        if (uiStore === undefined) return;

        const wndData = uiStore && Util.getLogicStore(uiStore, WndDataStore);
        if (wndData === undefined) return;

        if (wndData.wndState > EWndState.Opened) {
            UILogger.w(uiTag, `modifyWndLayer failed, uiStore is not open`);
            return;
        }

        this.decreaseOrderInLayer(uiStore);
        const sortingOrder = this.increaseOrderInLayer(uiStore, layer);
        this.modify(wndData, (v) => (v.sortingOrder = sortingOrder));
        UILogger.i(uiTag, `modifyWndLayer, sortingOrder: ${sortingOrder}`);

        if (wndData.wndState !== EWndState.Opened) return;
        UIEngineInterface._modifySortingOrder(uiStore, sortingOrder);
    }

    @D.linkUtil(createPrefabAsync)
    protected createPrefabAsync(owner: F.RStore, tag: string, parent?: UIResType, params?: unknown, callback?: (uiStore: RUIStore) => void): { cancel: () => void } {
        F.assert(owner.parent instanceof UIStore, `createPrefab failed, owner is not a ui logic store.`);
        const ownerUI = owner.parent;
        UILogger.d(tag, `createPrefabAsync, ownerUI: ${ownerUI.uiTag}`);

        const uiStore = this.createUIStore(ownerUI, tag);
        const prefabShell = { uiStore, cancel: () => !UIEngineInterface._findUIRes(uiStore) && this.destroyPrefab(uiStore) };
        this.modify(ownerUI, (v) => (v.dynamicPrefabs = v.dynamicPrefabs ?? new Map()).set(uiStore.id, prefabShell));
        this.loadUIRes(uiStore, parent ?? UIEngineInterface._findUIRes(ownerUI), params, () => callback?.(uiStore));
        return prefabShell;
    }

    @D.linkUtil(Util.destroyPrefab)
    protected destroyPrefab(uiStore: RUIStore) {
        const parent = uiStore.parent as UIStore | undefined;
        if (parent?.dynamicPrefabs?.has(uiStore.id) !== true) {
            if (parent?.prefabs?.has(uiStore.id) === true) UILogger.e(uiStore.uiTag, `destroyPrefab failed, prefab is not dynamic prefab, please use unbindPrefab`, F.getDebugStackTrace());
            return;
        }
        UILogger.d(uiStore.uiTag, `destroyPrefab, ownerUI: ${(uiStore.parent as UIStore).uiTag}`);

        const prefabShell = parent.dynamicPrefabs.get(uiStore.id);
        if (prefabShell === undefined) return;

        this.modify(parent, (v) => v.dynamicPrefabs?.delete(uiStore.id));
        this.unloadUIRes(uiStore, undefined, true);
        this.destroyUIStore(uiStore);
    }

    @D.linkUtil(Util.bindPrefab)
    protected bindPrefab(owner: F.RStore, uiRes: UIResType, uiTag: string, params?: unknown) {
        F.assert(owner.parent instanceof UIStore, `bindPrefab failed, owner is not a ui logic store.`);
        UILogger.d(uiTag, `bindPrefab, ownerUI: ${(owner.parent as UIStore).uiTag}`);

        const uiStore = this.createUIStore(owner.parent, uiTag);
        this.modify(owner.parent, (v) => (v.prefabs = v.prefabs ?? new Map()).set(uiStore.id, uiStore));
        UIEngineInterface._bindUIRes(uiStore, uiRes);
        iterChildrenAE(AE.OnWidgetBoundSEvent, uiStore, owner, uiRes, params);
        return uiStore;
    }

    @D.linkUtil(Util.unbindPrefab)
    protected unbindPrefab(uiStore: RUIStore) {
        const parent = uiStore.parent as UIStore | undefined;
        if (parent?.prefabs?.has(uiStore.id) !== true) {
            if (parent?.dynamicPrefabs?.has(uiStore.id) === true) UILogger.e(uiStore.uiTag, `unbindPrefab failed, prefab is dynamic prefab, please use destroyPrefab`, F.getDebugStackTrace());
            return;
        }
        UILogger.d(uiStore.uiTag, `unbindPrefab, ownerUI: ${(uiStore.parent as UIStore).uiTag}`);

        this.modify(parent, (v) => v.prefabs?.delete(uiStore.id));
        iterChildrenAE(AE.OnWidgetUnboundSEvent, uiStore, undefined);
        this.autoReleaseChild(uiStore);
        UIEngineInterface._unbindUIRes(uiStore);
        this.destroyUIStore(uiStore);
    }

    @D.on(UIRootStore)
    protected onRootStoreChanged(_: F.StoreChangeSEvent) {
        const rootStore = UIRootStore.getSingleton();
        const wndStackTop = rootStore.wndStack[rootStore.wndStack.length - 1];
        if (rootStore.lastWndStackTop === wndStackTop) return;
        AE.OnWndStackTopChangedEvent.dispatch(wndStackTop, rootStore.lastWndStackTop);
        this.modify(rootStore, (v) => (v.lastWndStackTop = wndStackTop));
    }

    private loadUIRes(uiStore: RUIStore, parent?: UIResType, params?: unknown, callback?: () => void) {
        UIEngineInterface._loadUIResAsync(uiStore, parent, (uiRes) => {
            iterChildrenAE(AE.OnWidgetBoundSEvent, uiStore, uiStore, uiRes, params);
            callback?.();
        });
    }

    private unloadUIRes(uiStore: RUIStore, params?: unknown, immediatelyDestroy?: boolean) {
        if (UIEngineInterface._findUIRes(uiStore)) {
            iterChildrenAE(AE.OnWidgetUnboundSEvent, uiStore, params);
            this.autoReleaseChild(uiStore);
        }
        UIEngineInterface._unloadUIRes(uiStore, immediatelyDestroy);
    }

    private createUIStore(owner: RUIStore | UIRootStore, uiTag: UITagType) {
        const uiStore = UIStore.create(owner);
        this.modify(uiStore, (v) => ((v.uiTag = uiTag), (v.uiTemplate = Util.getUITemplate(uiTag))));
        uiStore.uiTemplate.storeTags?.forEach((tag) => F.Store.isValidTag(tag) && F.createSSWithTag(tag, uiStore));
        return uiStore;
    }

    private destroyUIStore(uiStore: RUIStore) {
        uiStore.children && [...uiStore.children].forEach((v) => F.destroySS(v));
        F.Store.destroy(uiStore);
    }

    private createWnd(uiTag: UITagType) {
        const uiRootStore = UIRootStore.getSingleton();
        const uiStore = this.createUIStore(uiRootStore, uiTag);
        const wndData = WndDataStore.create(uiStore);
        this.modify(uiRootStore, (v) => v.wnds.set(uiTag, wndData));
        return { uiStore, wndData };
    }

    private destroyWnd(uiStore: RUIStore) {
        const uiRootStore = UIRootStore.getSingleton();
        this.destroyUIStore(uiStore);
        this.modify(uiRootStore, (v) => v.wnds.delete(uiStore.uiTag));
    }

    private pushWndStack(uiStore: RUIStore) {
        const newTag = uiStore.uiTag;
        // 判断当前 uiStore 是否可以入栈
        if (uiStore.uiTemplate.wnd?.stackManaged !== true) return;

        // 对当前栈顶窗口进行暂停
        const lastTopTag = Util.findWndStackTop();
        this.modify(UIRootStore.getSingleton(), (v) => {
            v.wndStack.push(uiStore.uiTag);
            v.wndStack.sort((a, b) => (v.wnds.get(a)?.sortingOrder ?? 0) - (v.wnds.get(b)?.sortingOrder ?? 0));
        });

        const lastTopWnd = lastTopTag !== undefined ? Util.findWnd(lastTopTag) : undefined;
        if (lastTopWnd === undefined) return;
        iterChildrenAE(AE.OnWndPausedSEvent, lastTopWnd, newTag);
        AE.OnWndPausedEvent.dispatch(lastTopTag as UITagType, newTag);
    }

    private popWndStack(uiStore: RUIStore) {
        const newTag = uiStore.uiTag;
        let lastTopTag = Util.findWndStackTop();
        this.modify(UIRootStore.getSingleton(), (v) => {
            const idx = v.wndStack.indexOf(newTag);
            if (idx !== -1) v.wndStack.splice(idx, 1);
            v.wndStack.sort((a, b) => (v.wnds.get(a)?.sortingOrder ?? 0) - (v.wnds.get(b)?.sortingOrder ?? 0));
        });
        if (lastTopTag !== newTag) return;

        // 对新的栈顶窗口进行 Resume
        lastTopTag = Util.findWndStackTop();
        const lastTopWnd = lastTopTag !== undefined ? Util.findWnd(lastTopTag) : undefined;
        if (lastTopWnd === undefined) return;
        iterChildrenAE(AE.OnWndResumedSEvent, lastTopWnd, newTag);
        AE.OnWndResumedEvent.dispatch(lastTopTag as UITagType, newTag);
    }

    private autoReleaseChild(uiStore: RUIStore) {
        uiStore.prefabs?.forEach((v) => this.unbindPrefab(v));
        uiStore.dynamicPrefabs?.forEach((v) => this.destroyPrefab(v.uiStore));
        this.modify(uiStore, (v) => ((v.prefabs = undefined), (v.dynamicPrefabs = undefined)));
    }

    private increaseOrderInLayer(uiStore: RUIStore, overrideLayer?: number) {
        const uiTag = uiStore.uiTag;
        const wndLayer = overrideLayer ?? uiStore.uiTemplate.wnd?.wndLayer ?? 0;
        const rootStore = UIRootStore.getSingleton();
        const orderRecord = rootStore.orderRecords.get(wndLayer) ?? new Map();
        let newOrder = 0;
        orderRecord.forEach((order) => (newOrder = Math.max(newOrder, order)));
        if (newOrder >= MAX_SUB_ORDER) newOrder = this.reallocationOrderInLayer(wndLayer);
        orderRecord.set(uiTag, ++newOrder);
        this.modify(rootStore, (v) => v.orderRecords.set(wndLayer, orderRecord));
        return calculateOrder(wndLayer, newOrder);
    }

    private decreaseOrderInLayer(uiStore: RUIStore) {
        const uiTag = uiStore.uiTag;
        const rootStore = UIRootStore.getSingleton();
        this.modify(rootStore, (v) => {
            for (const [_, orderRecord] of v.orderRecords) {
                if (orderRecord.has(uiTag)) {
                    orderRecord.delete(uiTag);
                    break;
                }
            }
        });
    }

    private reallocationOrderInLayer(wndLayer: number) {
        let topOrder = 0;
        const rootStore = UIRootStore.getSingleton();
        const orderRecord = rootStore.orderRecords.get(wndLayer);
        if (orderRecord === undefined) return topOrder;

        orderRecord.forEach((order, uiTag) => {
            const uiStore = Util.findWnd(uiTag);
            if (uiStore === undefined) return;

            order = topOrder++;
            const sortingOrder = calculateOrder(wndLayer, order);
            UILogger.i(uiTag, `reallocationOrderInLayer, sortingOrder: ${sortingOrder}`);
            UIEngineInterface._modifySortingOrder(uiStore, sortingOrder);
            orderRecord.set(uiTag, order);
        });
        return topOrder;
    }
}

function safeExec(uiTag: string, func: () => void) {
    try {
        func();
    } catch (error: any) {
        UILogger.e(uiTag, error.toString(), error.stack);
    }
}

function calculateOrder(wndLayer: number, order: number) {
    return wndLayer * 1000 + order * 10;
}

function iterChildrenAE<T extends F.Constructor<F.StoreAction | F.StoreEvent>>(actionCtor: T, uiStore: RUIStore, ...args: ConstructorParameters<T>) {
    // let startTime = Date.now();
    const func = "do" in actionCtor ? "do" : "dispatch";
    safeExec(uiStore.uiTag, () => uiStore.children?.forEach((v) => (actionCtor as any)[func](v, ...args)));
    // let duration = Date.now() - startTime;
    // if (duration > 100) UILogger.e(uiStore.uiTag, `${actionCtor.name} time:${duration}ms`);
    // else if (duration > 50) UILogger.w(uiStore.uiTag, `${actionCtor.name} time:${duration}ms`);
    // else UILogger.i(uiStore.uiTag, `${actionCtor.name} time:${Date.now() - startTime}ms`);
}
