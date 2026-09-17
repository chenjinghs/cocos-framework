import { F } from "k-ts-framework";

import { EWndState, IUITemplate, RUIStore, UIResType, UIRootStore, UIStore, UITagType } from "./Define";
import { UIEngineInterface } from "./EngineInterface";

// -------------------------------------------------------------
// Wnd

/** 打开一个 Wnd 窗口 */
export const openWnd = F.createUtilLinker<<P = undefined>(wndTag: UITagType, params?: P extends undefined ? undefined : P, overrideLayer?: number) => void>();

/** 关闭一个 Wnd 窗口 */
export const closeWnd = F.createUtilLinker<<P = undefined>(wndTag: UITagType, params?: P extends undefined ? undefined : P) => void>();

/** 强制关闭所有 Wnd 窗口 */
export const closeAllWnds = F.createUtilLinker<(ignoreWnds?: UITagType | UITagType[], regexp?: string) => void>();

/** 注册一个 PendingTask */
export const registerWndPendingTask = F.createUtilLinker<(wndTag: UITagType, taskHandle: symbol) => void>();

/** 完成一个已注册的 PendingTask */
export const resolveWndPendingTask = F.createUtilLinker<(wndTag: UITagType, taskHandle: symbol) => boolean>();

/** 判断一个 PendingTask 是否还有效 */
export const isValidWndPendingTask = F.createUtilLinker<(wndTag: UITagType, taskHandle: symbol) => boolean>();

/** 修改 Wnd 窗口的渲染层级 */
export const modifyWndLayer = F.createUtilLinker<(wndTag: UITagType, layer: number) => void>();

/** 查找一个 Wnd 对应的 WndStore(UIStore) */
export function findWnd(wndTag: UITagType): RUIStore | undefined {
    return UIRootStore.getSingleton().wnds.get(wndTag)?.parent as RUIStore | undefined;
}

/** 判断一个 Wnd 是否开启，只要处于 open 状态就算，可能还在加载中 */
export function isWndOpen(wndTag: UITagType) {
    let wndData = UIRootStore.getSingleton().wnds.get(wndTag);
    if (wndData === undefined) return false;
    return wndData.wndState <= EWndState.Opened;
}

/** 判断一个 Wnd 是否完全开启 */
export function isWndOpened(wndTag: UITagType) {
    let wndData = UIRootStore.getSingleton().wnds.get(wndTag);
    if (wndData === undefined) return false;
    return wndData.wndState === EWndState.Opened;
}

// -------------------------------------------------------------
// WndStack

export function getWndStack(): ReadonlyArray<string> {
    return UIRootStore.getSingleton().wndStack;
}

export function findWndStackTop(): string | undefined {
    let stack = getWndStack();
    return stack[stack.length - 1];
}

export function isWndStackTop(wndTag: UITagType) {
    return findWndStackTop() === wndTag;
}

export function closeAllWndStack(ignoreWnds?: UITagType | UITagType[], ignoreRegexp?: string) {
    if (ignoreWnds !== undefined) ignoreWnds = Array.isArray(ignoreWnds) ? ignoreWnds : [ignoreWnds];
    const stack = getWndStack();
    const reg = ignoreRegexp ? new RegExp(ignoreRegexp) : undefined;
    [...stack].forEach((wndTag) => {
        if (ignoreWnds?.includes(wndTag)) return;
        if (reg?.test(wndTag)) return;
        closeWnd(wndTag);
    });
}

// -------------------------------------------------------------
// Prefab

/**
 * 解绑 Prefab 逻辑脚本并对其 UIRes 进行销毁
 * @param prefabStore
 */
export const destroyPrefab = F.createUtilLinker<<P = undefined>(prefabStore: RUIStore, params?: P extends undefined ? undefined : P) => void>();

/**
 * 绑定 Prefab UMG 逻辑脚本
 * @param owner
 * @param uiRes
 * @param tag 指定绑定的 UI 资源的 tag，如果不指定则使用 uiRes 的 tag
 * @returns
 */
export const bindPrefab = F.createUtilLinker<<P = undefined, T extends {} = {}>(owner: F.RStore, uiRes: T, tag: string, params?: P extends undefined ? undefined : P) => RUIStore>();

/**
 * 解绑 Prefab 逻辑脚本（不会主动销毁资源）
 * @param prefabStore
 */
export const unbindPrefab = F.createUtilLinker<<P = undefined>(prefabStore: RUIStore, params?: P extends undefined ? undefined : P) => void>();

// -------------------------------------------------------------
// Other

/**
 * 获取 UI 配置信息(项目实现)
 * @param uiTag
 * @returns
 */
export const getUITemplate = F.createUtilLinker<(uiTag: UITagType) => IUITemplate>();

/**
 * 根据logicStore的构造函数获取一个UIStore的logicStore
 * @param store 要查找的UIStore
 * @param ctor logicStore的构造函数
 * @returns UIStore的logicStore,找不到则返回undefined
 */
export function getLogicStore<T extends typeof F.Store>(store: RUIStore, ctor: T): Readonly<InstanceType<T>> {
    let logicStore = F.findStoreChildByCtor(store, ctor);
    F.assert(logicStore, `[${store.uiTag}] cannot find logicStore by ctor ${ctor.name}`);
    return logicStore;
}

/**
 * 获取一个 UI 对应的 UIRes
 * @param store
 * @returns
 */
export function getRootWidget<T extends UIResType>(store: F.RStore) {
    let uiStore = store instanceof UIStore ? store : F.getStoreParent<UIStore>(store);
    let uiRes = UIEngineInterface._findUIRes<T>(uiStore);
    F.assert(uiRes, `[${uiStore.uiTag}] cannot find uiRes`);
    return uiRes;
}

/**
 * 获取一个 UIStore/LogicStore 的顶层 UIStore 的 tag
 * @param store
 * @returns
 */
export function getParentWndTag(store: F.RStore, allowUndefined: true): string | undefined;
export function getParentWndTag(store: F.RStore, allowUndefined?: false): string;
export function getParentWndTag(store: F.RStore, allowUndefined = false) {
    let topUIStore = store;
    while (topUIStore.parent && topUIStore.parent instanceof UIStore) topUIStore = topUIStore.parent;
    if (topUIStore instanceof UIStore) return topUIStore.uiTag;
    F.assert(topUIStore instanceof UIStore || allowUndefined, "topUIStore is not UIStore");
    return undefined;
}
