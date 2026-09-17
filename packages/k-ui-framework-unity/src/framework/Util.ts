import { F } from "k-ts-framework";
import { GameObjectUtil, PrefabProxy } from "k-ts-framework-unity";
import { bindPrefab, RUIStore, UITagType } from "k-ui-framework";

export const GetUIContainerTransform = F.createUtilLinker<() => CS.UnityEngine.RectTransform>();

export const getUICamera = F.createUtilLinker<() => CS.UnityEngine.Camera>();

export const findPrefabProxy = F.createUtilLinker<<T>(store: F.RStore) => PrefabProxy<T> | undefined>();

export const getPrefabProxy = F.createUtilLinker<<T>(store: F.RStore) => PrefabProxy<T>>();

export function addWidgetToParent(obj: CS.UnityEngine.GameObject, parent: CS.UnityEngine.GameObject, expandParent = false) {
    obj.transform.SetParent(parent.transform);
    obj.transform.localPosition = CS.UnityEngine.Vector3.one;
    obj.transform.localScale = CS.UnityEngine.Vector3.one;

    if (expandParent === false) return;
    let rectTransform = GameObjectUtil.getComponent(obj, CS.UnityEngine.RectTransform);
    rectTransform.offsetMax = new CS.UnityEngine.Vector2(0, 0);
    rectTransform.offsetMin = new CS.UnityEngine.Vector2(0, 0);
}

export function removeWidgetFromParent(obj: CS.UnityEngine.GameObject) {
    obj.transform.SetParent(null as any);
}

export function loadAndSetSpriteWithDir(compOrObj: CS.UnityEngine.Component | CS.UnityEngine.GameObject, dir: string, spriteName: string, withNativeSize = false) {
    loadAndSetSprite(compOrObj, dir + spriteName + ".png", withNativeSize);
}

export function loadAndSetSprite(compOrObj: CS.UnityEngine.Component | CS.UnityEngine.GameObject, spritePath: string, withNativeSize = false) {
    if (!compOrObj) return;
    let loader = GameObjectUtil.findOrAddComponent(compOrObj.gameObject, CS.KingSoft.UI.SpriteAsyncLoader);
    loader.Load(spritePath, withNativeSize);
}

export function bindPrefabsWithChildren(owner: F.RStore, parentNode: CS.UnityEngine.Transform | CS.UnityEngine.GameObject, tag: UITagType, params?: any | any[]) {
    let parentTrans = parentNode.transform;
    let childCount = parentTrans.childCount;
    let prefabStores = new Array<RUIStore>(childCount);
    for (let i = 0; i < childCount; ++i) prefabStores[i] = bindPrefab(owner, parentTrans.GetChild(i).gameObject, tag, params ? (Array.isArray(params) ? params[i] : params) : undefined);
    return prefabStores;
}
