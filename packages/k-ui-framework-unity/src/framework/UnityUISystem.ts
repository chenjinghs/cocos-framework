import { D, F } from "k-ts-framework";
import { ASYNC_LOAD_AND_INSTANTIATE, GameObjectUtil, PrefabProxy } from "k-ts-framework-unity";
import { getUITemplate, RUIStore, UIEngineInterface, UILogger, UIStore } from "k-ui-framework";

import { UNITY_UI_SYSTEM_TAG } from "./Define";
import { _bindRes, _unbindRes } from "./PrivateUtil";
import { findPrefabProxy, getPrefabProxy, getUICamera, GetUIContainerTransform } from "./Util";

const UI_ROOT_OBJ_NAME = "UIRoot";
const UI_CAMERA_OBJ_NAME = "UICamera";

type CSGameObject = CS.UnityEngine.GameObject;
const CSGameObject = CS.UnityEngine.GameObject;
const CSWidgetTreeComponent = CS.KingSoft.UI.WidgetTreeComponent;
const CSCanvas = CS.UnityEngine.Canvas;
const CSGraphicRaycaster = CS.UnityEngine.UI.GraphicRaycaster;

const VECTOR_3_ACTIVE = CS.UnityEngine.Vector3.zero;
const VECTOR_3_INACTIVE = new CS.UnityEngine.Vector3(1920, 2640, 10000);
const DELAY_DESTROY_TIME = 1;

@D.store()
class UnityUIRootStore extends F.SingletonStore {
    public uiRoot: CSGameObject;
    public uiResolutionController: CS.KingSoft.UI.UIResolutionController;
    public uiCamera: CS.UnityEngine.Camera;
    public orderRecords: Map<number /** wndLayer */, Map<string /** uiTag */, number /** order */>> = new Map();
    public asyncLoadHandles: Map<number /** store.id */, number> = new Map();
}

@D.store()
class UnityUIStore extends F.Store {
    public isLoadedBySystem = false;
    public uiRes: CSGameObject;
    public prefabProxy: PrefabProxy;
}

@D.system(UNITY_UI_SYSTEM_TAG, [UnityUIRootStore, UnityUIStore])
class UnityUISystem extends F.System {
    public init(): boolean {
        let uiRoot = GameObjectUtil.get(UI_ROOT_OBJ_NAME);
        let uiResolutionController = GameObjectUtil.getComponent(uiRoot, CS.KingSoft.UI.UIResolutionController);
        let uiCamera = GameObjectUtil.getComponent(GameObjectUtil.get(UI_CAMERA_OBJ_NAME), CS.UnityEngine.Camera);
        this.modify(UnityUIRootStore.getSingleton(), (v) => ((v.uiRoot = uiRoot), (v.uiResolutionController = uiResolutionController), (v.uiCamera = uiCamera)));
        return uiRoot !== undefined;
    }

    public uninit(): void {
        F.findStoresByCtor(UnityUIStore)?.forEach((store) => store.isLoadedBySystem && this.unbindUIRes(F.getStoreParent(store)));
    }

    @D.linkUtil(UIEngineInterface._findUIRes<CSGameObject>)
    public findUIRes(uiStore: RUIStore) {
        return F.findStoreChildByCtor(uiStore, UnityUIStore)?.uiRes;
    }

    @D.linkUtil(GetUIContainerTransform)
    public GetUIContainerTransform() {
        return UnityUIRootStore.getSingleton().uiResolutionController.GetContainerTransform();
    }

    @D.linkUtil(getUICamera)
    public getUICamera() {
        return UnityUIRootStore.getSingleton().uiCamera;
    }

    @D.linkUtil(findPrefabProxy)
    public findPrefabProxy(store: F.RStore) {
        if (store.valid === false) return undefined;
        let uiStore = store instanceof UIStore ? store : F.getStoreParent<UIStore>(store);
        return F.findStoreChildByCtor(uiStore, UnityUIStore)?.prefabProxy;
    }

    @D.linkUtil(getPrefabProxy)
    public getPrefabProxy(store: F.RStore) {
        let uiStore = store instanceof UIStore ? store : F.getStoreParent<UIStore>(store);
        let prefabProxy = F.findStoreChildByCtor(uiStore, UnityUIStore)?.prefabProxy;
        F.assert(prefabProxy, `[${uiStore.uiTag}] cannot find prefabProxy, store.id:${uiStore.id}`);
        return prefabProxy;
    }

    @D.linkUtil(UIEngineInterface._loadUIResAsync<CSGameObject>)
    public loadUIResAsync(uiStore: RUIStore, parent?: CSGameObject, callback?: (res: any) => void) {
        let rootStore = UnityUIRootStore.getSingleton();
        let template = getUITemplate(uiStore.uiTag);
        let resPath = template.resPath;
        F.assert(resPath, `[${uiStore.uiTag}] cannot find resPath`);
        F.assert(!rootStore.asyncLoadHandles.has(uiStore.id), `loadUIResAsync failed, store.id:${uiStore.id} is loading`);

        let onLoadAndInstantiateFinished = (res?: CS.UnityEngine.Object) => {
            F.assert(res instanceof CSGameObject, `loadUIRes failed, res.path:${resPath}`);
            this.modify(rootStore, (v) => v.asyncLoadHandles.delete(uiStore.id));
            if (parent === undefined) setActive(res, false);
            this.bindUIRes(uiStore, res, true);
            callback?.(res);
        };

        let handle = this.subscribe(ASYNC_LOAD_AND_INSTANTIATE, resPath, uiStore.uiTag, parent ?? rootStore.uiRoot, onLoadAndInstantiateFinished);
        this.modify(rootStore, (v) => v.asyncLoadHandles.set(uiStore.id, handle));
    }

    @D.linkUtil(UIEngineInterface._unloadUIRes)
    public unloadUIRes(uiStore: RUIStore, immediatelyDestroy?: boolean) {
        let rootStore = UnityUIRootStore.getSingleton();
        let asyncHandle = rootStore.asyncLoadHandles.get(uiStore.id);
        if (asyncHandle !== undefined) {
            this.unsubscribeWithHandle(asyncHandle);
            this.modify(rootStore, (v) => v.asyncLoadHandles.delete(uiStore.id));
            return;
        }
        let uiRes = this.findUIRes(uiStore);
        this.unbindUIRes(uiStore);
        GameObjectUtil.destroy(uiRes, immediatelyDestroy ? 0 : DELAY_DESTROY_TIME);
    }

    @D.linkUtil(UIEngineInterface._bindUIRes<CSGameObject>)
    public bindUIRes(uiStore: RUIStore, uiRes: CSGameObject, isLoadedBySystem = false) {
        UILogger.d(uiStore.uiTag, `bindUIRes, store.id:${uiStore.id}`);

        GameObjectUtil.findOrAddComponent(uiRes, CSWidgetTreeComponent);
        let store = UnityUIStore.create(uiStore);
        let prefabProxy = new PrefabProxy<any>(uiRes);
        this.modify(store, (v) => ((v.uiRes = uiRes), (v.prefabProxy = prefabProxy), (v.isLoadedBySystem = isLoadedBySystem)));
        uiStore.children?.forEach((child) => _bindRes(child, prefabProxy));
    }

    @D.linkUtil(UIEngineInterface._unbindUIRes)
    public unbindUIRes(uiStore: RUIStore) {
        UILogger.d(uiStore.uiTag, `unbindUIRes, store.id:${uiStore.id}`);

        uiStore.children?.forEach((child) => _unbindRes(child));
        let store = F.findStoreChildByCtor(uiStore, UnityUIStore);
        store && F.Store.destroy(store);
    }

    @D.linkUtil(UIEngineInterface._addToScreen)
    public addToScreen(uiStore: RUIStore, sortingOrder: number) {
        UILogger.d(uiStore.uiTag, `addToScreen sortingOrder:${sortingOrder}`);
        let uiRes = this.findUIRes(uiStore);
        F.assert(uiRes, `cannot find uiRes, uiTag:${uiStore.uiTag}`);
        setActive(uiRes, true);

        let rootStore = UnityUIRootStore.getSingleton();
        rootStore.uiResolutionController.AddToScreen(uiRes);

        let canvas = GameObjectUtil.findOrAddComponent(uiRes, CSCanvas);
        GameObjectUtil.findOrAddComponent(uiRes, CSGraphicRaycaster);
        canvas.overrideSorting = true;
        canvas.sortingOrder = sortingOrder;
    }

    @D.linkUtil(UIEngineInterface._removeFromScreen)
    public removeFromScreen(uiStore: RUIStore) {
        UILogger.d(uiStore.uiTag, `removeFromScreen`);

        let uiRes = this.findUIRes(uiStore);
        if (uiRes === undefined) return; // 可能 UI 没有打开过

        // let rootStore = UnityUIRootStore.getSingleton();
        // rootStore.uiResolutionController.RemoveFromScreen(uiRes);
        setActive(uiRes, false, true);
        uiRes.name = uiRes.name + "_ToBeDestroy";
    }

    @D.linkUtil(UIEngineInterface._modifySortingOrder)
    public modifySortingOrder(uiStore: RUIStore, sortingOrder: number) {
        let uiRes = this.findUIRes(uiStore);
        F.assert(uiRes, `cannot find uiRes, uiTag:${uiStore.uiTag}`);
        let canvas = GameObjectUtil.getComponent(uiRes, CSCanvas);
        canvas.sortingOrder = sortingOrder;
    }
}

function setActive(uiRes: CSGameObject, isActive: boolean, usePosZ?: boolean) {
    if (usePosZ) uiRes.transform.localPosition = isActive ? VECTOR_3_ACTIVE : VECTOR_3_INACTIVE;
    else uiRes.gameObject.SetActive(isActive);
}
