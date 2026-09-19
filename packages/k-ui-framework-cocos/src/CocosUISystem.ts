import { D, F } from "k-ts-framework";
import { ASYNC_LOAD_AND_INSTANTIATE, cc, isValidNode } from "k-ts-framework-cocos";
import { getUITemplate, IUITemplate, RUIStore, UIEngineInterface, UILogger, UITagType } from "k-ui-framework";

import { COCOS_UI_SYSTEM_TAG, UI_PANEL_PREFIX, UI_ROOT_NAME } from "./Define.js";
import { findPrefabProxy, getPrefabProxy, PrefabProxyEx } from "./PrefabProxyEx.js";
import { _bindRes, _unbindRes } from "./PrivateUtil.js";

/** uiTag -> 模板注册表（消费项目经 registerCocosUITemplate 覆盖） */
const uiTemplateRegistry = new Map<UITagType, IUITemplate>();

/** 注册一个 UI 的模板配置；未注册的 tag 走默认约定（resources/ui/<uiTag>.prefab，wndLayer 1） */
export function registerCocosUITemplate(uiTag: UITagType, template: IUITemplate) {
    uiTemplateRegistry.set(uiTag, template);
}

@D.store()
class CocosUIRootStore extends F.SingletonStore {
    public canvasNode: cc.Node | null = null;
    public uiRoot: cc.Node | null = null;
    /** 已上屏窗口节点的排序权重，驱动 siblingIndex 重排 */
    public sortingOrders = new Map<cc.Node, number>();
    public asyncLoadHandles: Map<number /** store.id */, number> = new Map();
}

@D.store()
class CocosUIStore extends F.Store {
    public isLoadedBySystem = false;
    public uiRes: cc.Node | null = null;
    public prefabProxy: PrefabProxyEx | null = null;
}

/**
 * 找到场景 Canvas 并在其下创建/复用 UIRoot 子树。
 * 幂等；场景未加载或没有 Canvas 时抛错。
 */
export function attachUIRootToScene(): cc.Node {
    let scene = cc.director.getScene();
    F.assert(scene !== null, "CocosUISystem: no active scene, cannot attach UIRoot");

    let canvas = scene.getComponentInChildren(cc.Canvas);
    F.assert(canvas !== null, "CocosUISystem: no cc.Canvas found in scene, cannot attach UIRoot");

    let uiRoot = canvas.node.getChildByName(UI_ROOT_NAME);
    if (uiRoot === null) {
        uiRoot = new cc.Node(UI_ROOT_NAME);
        canvas.node.addChild(uiRoot);
    }
    return uiRoot;
}

@D.system(COCOS_UI_SYSTEM_TAG, [CocosUIRootStore, CocosUIStore])
class CocosUISystem extends F.System {
    public init(): boolean {
        return true;
    }

    public uninit(): void {
        F.findStoresByCtor(CocosUIStore)?.forEach((store) => store.isLoadedBySystem && this.unbindUIRes(F.getStoreParent(store)));
    }

    /** 惰性确保 UIRoot（场景可能晚于系统创建才加载） */
    private ensureUIRoot(): cc.Node {
        let rootStore = CocosUIRootStore.getSingleton();
        if (rootStore.uiRoot && isValidNode(rootStore.uiRoot)) return rootStore.uiRoot;

        let canvas = cc.director.getScene()?.getComponentInChildren(cc.Canvas) ?? null;
        let uiRoot = attachUIRootToScene();
        this.modify(rootStore, (v) => {
            v.uiRoot = uiRoot;
            v.canvasNode = canvas?.node ?? null;
        });
        return uiRoot;
    }

    @D.linkUtil(getUITemplate)
    protected getUITemplateImpl(uiTag: UITagType): IUITemplate {
        return uiTemplateRegistry.get(uiTag) ?? { wnd: { wndLayer: 1 } };
    }

    @D.linkUtil(UIEngineInterface._findUIRes<cc.Node>)
    public findUIRes(uiStore: RUIStore) {
        return F.findStoreChildByCtor(uiStore, CocosUIStore)?.uiRes ?? undefined;
    }

    @D.linkUtil(UIEngineInterface._loadUIResAsync<cc.Node>)
    public loadUIResAsync(uiStore: RUIStore, parent?: cc.Node, callback?: (res: cc.Node) => void) {
        let rootStore = CocosUIRootStore.getSingleton();
        let resPath = uiStore.uiTemplate.resPath ?? `${UI_PANEL_PREFIX}${uiStore.uiTag}.prefab`;
        F.assert(!rootStore.asyncLoadHandles.has(uiStore.id), `loadUIResAsync failed, store.id:${uiStore.id} is loading`);

        let onLoadAndInstantiateFinished = (res?: cc.Node) => {
            F.assert(res instanceof cc.Node, `loadUIRes failed, res.path:${resPath}`);
            this.modify(rootStore, (v) => {
                v.asyncLoadHandles.delete(uiStore.id);
            });
            if (parent === undefined) res.active = false;
            this.bindUIRes(uiStore, res, true);
            callback?.(res);
        };

        // reason: 跨包 System 重载增强在 ts7 引用重定向下为幽灵态(仅类型层),这里显式收窄为基类透传签名,保证 src 自检/ts7 构建/dist 消费三种上下文一致可编译
        let handle = (this.subscribe as (...args: unknown[]) => number).call(this, ASYNC_LOAD_AND_INSTANTIATE, resPath, uiStore.uiTag, parent ?? this.ensureUIRoot(), onLoadAndInstantiateFinished);
        this.modify(rootStore, (v) => {
            v.asyncLoadHandles.set(uiStore.id, handle);
        });
    }

    @D.linkUtil(UIEngineInterface._unloadUIRes)
    public unloadUIRes(uiStore: RUIStore, _immediatelyDestroy?: boolean) {
        let rootStore = CocosUIRootStore.getSingleton();
        let asyncHandle = rootStore.asyncLoadHandles.get(uiStore.id);
        if (asyncHandle !== undefined) {
            this.unsubscribeWithHandle(asyncHandle);
            this.modify(rootStore, (v) => {
                v.asyncLoadHandles.delete(uiStore.id);
            });
            return;
        }
        let uiRes = this.findUIRes(uiStore);
        this.unbindUIRes(uiStore);
        if (uiRes && isValidNode(uiRes)) uiRes.destroy();
    }

    @D.linkUtil(UIEngineInterface._bindUIRes<cc.Node>)
    public bindUIRes(uiStore: RUIStore, uiRes: cc.Node, isLoadedBySystem = false) {
        UILogger.d(uiStore.uiTag, `bindUIRes, store.id:${uiStore.id}`);

        let store = CocosUIStore.create(uiStore);
        let prefabProxy = new PrefabProxyEx(uiRes);
        this.modify(store, (v) => {
            v.uiRes = uiRes;
            v.prefabProxy = prefabProxy;
            v.isLoadedBySystem = isLoadedBySystem;
        });
        uiStore.children?.forEach((child) => _bindRes(child, prefabProxy));
    }

    @D.linkUtil(UIEngineInterface._unbindUIRes)
    public unbindUIRes(uiStore: RUIStore) {
        UILogger.d(uiStore.uiTag, `unbindUIRes, store.id:${uiStore.id}`);

        uiStore.children?.forEach((child) => _unbindRes(child));
        let store = F.findStoreChildByCtor(uiStore, CocosUIStore);
        store && F.Store.destroy(store);
    }

    @D.linkUtil(UIEngineInterface._addToScreen)
    public addToScreen(uiStore: RUIStore, sortingOrder: number) {
        UILogger.d(uiStore.uiTag, `addToScreen sortingOrder:${sortingOrder}`);
        let uiRes = this.findUIRes(uiStore);
        F.assert(uiRes, `cannot find uiRes, uiTag:${uiStore.uiTag}`);

        let uiRoot = this.ensureUIRoot();
        if (uiRes.parent !== uiRoot) uiRoot.addChild(uiRes);
        uiRes.active = true;

        let rootStore = CocosUIRootStore.getSingleton();
        this.modify(rootStore, (v) => {
            v.sortingOrders.set(uiRes, sortingOrder);
        });
        this.reorderUIRootChildren();
    }

    @D.linkUtil(UIEngineInterface._removeFromScreen)
    public removeFromScreen(uiStore: RUIStore) {
        UILogger.d(uiStore.uiTag, `removeFromScreen`);

        let uiRes = this.findUIRes(uiStore);
        if (uiRes === undefined) return; // 可能 UI 没有打开过

        uiRes.removeFromParent(); // 不 destroy，跟随 wnd 生命周期
        let rootStore = CocosUIRootStore.getSingleton();
        this.modify(rootStore, (v) => {
            v.sortingOrders.delete(uiRes);
        });
    }

    @D.linkUtil(UIEngineInterface._modifySortingOrder)
    public modifySortingOrder(uiStore: RUIStore, sortingOrder: number) {
        let uiRes = this.findUIRes(uiStore);
        F.assert(uiRes, `cannot find uiRes, uiTag:${uiStore.uiTag}`);

        let rootStore = CocosUIRootStore.getSingleton();
        this.modify(rootStore, (v) => {
            v.sortingOrders.set(uiRes, sortingOrder);
        });
        this.reorderUIRootChildren();
    }

    /** Cocos 无 sortingOrder，按权重升序重排 UIRoot 下窗口节点的 siblingIndex（同值保持现有相对顺序） */
    private reorderUIRootChildren() {
        let rootStore = CocosUIRootStore.getSingleton();
        let uiRoot = rootStore.uiRoot;
        if (!uiRoot || !isValidNode(uiRoot)) return;

        // 以当前 sibling 顺序为基准，稳定排序后写回；同值节点自然保持现有相对顺序
        let ordered = uiRoot.children.filter((node): node is cc.Node => rootStore.sortingOrders.has(node)).map((node) => [node, rootStore.sortingOrders.get(node) as number] as [cc.Node, number]);
        ordered.sort((a, b) => a[1] - b[1]);
        ordered.forEach(([node], index) => {
            if (node.getSiblingIndex() !== index) node.setSiblingIndex(index);
        });
    }

    @D.linkUtil(findPrefabProxy)
    public findPrefabProxyImpl(store: F.RStore) {
        return F.findStoreChildByCtor(store, CocosUIStore)?.prefabProxy ?? undefined;
    }

    @D.linkUtil(getPrefabProxy)
    public getPrefabProxyImpl(store: F.RStore) {
        let proxy = this.findPrefabProxyImpl(store);
        F.assert(proxy, `getPrefabProxy failed, store ${store.constructor.name} has no bound prefab`);
        return proxy;
    }
}
