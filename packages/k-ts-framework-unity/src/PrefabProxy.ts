import { F } from "k-ts-framework";

import { GameObjectUtil } from "./GameObjectUtil";

export class PrefabProxy<T = unknown, K extends Extract<keyof T, string> = Extract<keyof T, string>> {
    public widgetTree: CS.KingSoft.UI.WidgetTreeComponent;

    public constructor(public readonly rootObject: CS.UnityEngine.GameObject) {
        this.widgetTree = GameObjectUtil.findOrAddComponent(rootObject, CS.KingSoft.UI.WidgetTreeComponent);
        F.assert(this.widgetTree, `cannot find WidgetTreeComponent in [${rootObject.name}]`);
    }

    public markTreeDirty() {
        this.widgetTree.MarkTreeDirty();
    }

    /** 获取 gameObject (有断言，结果不允许为空) */
    public getGameObject(name: K) {
        let obj = this.widgetTree.FindGameObject(name);
        F.assert(obj, `cannot find [${name}] in [${this.rootObject.name}]`);
        return obj;
    }

    public findGameObject(name: K) {
        let obj = this.widgetTree.FindGameObject(name);
        if (obj === null) return undefined;
        return obj;
    }

    public getTransform<T extends typeof CS.UnityEngine.Transform>(name: K): InstanceType<T> {
        let trans = this.widgetTree.FindTransform(name);
        F.assert(trans, `cannot find [${name}] in [${this.rootObject.name}]`);
        return trans as InstanceType<T>;
    }

    public getComponentWithPath<T extends typeof CS.UnityEngine.Component>(name: K, path: string, type?: T): InstanceType<T> {
        let trans = this.widgetTree.FindTransform(name);
        F.assert(trans, `cannot find [${name}] in [${this.rootObject.name}]`);
        return GameObjectUtil.getComponentWithPath<T>(trans, path, type);
    }

    public getGameObjectWithPath(name: K, path: string): CS.UnityEngine.GameObject {
        return this.getComponentWithPath(name, path).gameObject;
    }

    public findComponentWithPath<T extends typeof CS.UnityEngine.Component>(name: K, path: string, type?: T): InstanceType<T> | undefined {
        let trans = this.widgetTree.FindTransform(name);
        if (trans === null) return undefined;
        return GameObjectUtil.findComponentWithPath<T>(trans, path, type);
    }

    public findGameObjectWithPath(name: K, path: string): CS.UnityEngine.GameObject | undefined {
        return this.findComponentWithPath(name, path)?.gameObject;
    }

    /** 获取 object 上的 component(不带断言) */
    public findComponent<CC extends typeof CS.UnityEngine.Component>(name: K, type: CC): InstanceType<CC> | undefined {
        return this.widgetTree.FindComponent(name, puer.$typeof(type)) as InstanceType<CC>;
    }

    /** 获取 object 上的 component(带断言) */
    public getComponent<CC extends typeof CS.UnityEngine.Component>(name: K, type: CC): InstanceType<CC> {
        let component = this.findComponent(name, type);
        F.assert(component, `cannot find component [${type.name}] in [${this.rootObject.name}][${name}], type: ${type}`);
        return component;
    }

    public findOrAddComponent<CC extends typeof CS.UnityEngine.Component>(name: K, type: CC): InstanceType<CC> {
        return this.widgetTree.FindOrAddComponent(name, puer.$typeof(type)) as InstanceType<CC>;
    }

    /** 设置 object 的 active 状态 */
    public setActive(childObjectName: K, active: boolean) {
        this.getGameObject(childObjectName).SetActive(active);
    }

    public isActiveSelf(childObjectName: K) {
        return this.getGameObject(childObjectName).activeSelf;
    }

    public isActiveInHierarchy(childObjectName: K) {
        return this.getGameObject(childObjectName).activeInHierarchy;
    }
}
