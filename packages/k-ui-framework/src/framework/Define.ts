import { D, F } from "k-ts-framework";

export const UI_SYSTEM_TAG = "UISystemTag";

export type UITagType = string;
export type UIResType = {};
export type UIParamsType = {};
export type RUIStore = Readonly<UIStore>;

/** UI 通用配置接口（Wnd、Prefab） */
export interface IUITemplate {
    /** UI 资源路径 */
    resPath?: string;
    /** UI 逻辑挂载的 Tag 列表，默认会挂载 uiTag，不需要传 */
    storeTags?: string[];
    /** Wnd 配置，仅在 UI 为 Wnd 时需要配置 */
    wnd?: {
        /** UI 渲染层级 */
        wndLayer: number;
        /** 是否受 UIStack 管理 */
        stackManaged?: boolean;
    };
}

export enum EWndState {
    Opening,
    Opened,
    Closing,
    Closed,
}

interface IDynamicPrefabData {
    uiStore: RUIStore;
    cancel: () => void;
}

@D.store()
export class UIStore extends F.Store {
    uiTag: UITagType;
    uiTemplate: IUITemplate;
    prefabs?: Map<number /** store.id */, RUIStore>;
    dynamicPrefabs?: Map<number /** store.id */, IDynamicPrefabData>;
}

@D.store()
export class WndDataStore extends F.Store {
    wndState: EWndState;
    sortingOrder: number;
    openAsyncHandle?: symbol;
    pendingHandles?: Set<symbol>;
    
    pendingOpenOnClosed?: {params: unknown, overrideLayer?: number}
}

@D.store()
export class UIRootStore extends F.SingletonStore {
    public wnds: Map<UITagType, WndDataStore> = new Map();
    public wndStack: UITagType[] = [];
    public lastWndStackTop?: UITagType;
    public orderRecords: Map<number /** wndLayer */, Map<string /** uiTag */, number /** order */>> = new Map();
}
