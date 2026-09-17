import { F } from "k-ts-framework";

type GameObject = CS.UnityEngine.GameObject;
const GameObject = CS.UnityEngine.GameObject;

type Transform = CS.UnityEngine.Transform;
const Transform = CS.UnityEngine.Transform;

type Component = CS.UnityEngine.Component;
const Component = CS.UnityEngine.Component;

type GameObjectOrComponent = GameObject | Component;

const IsNullObject = CS.KTSLauncher.KTSLibrary.IsNullObject;

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace GameObjectUtil {
    /**
     * 判断一个 Object 是否为 null
     * @param obj
     * @returns
     */
    export function isNull(obj: CS.UnityEngine.Object) {
        return IsNullObject(obj);
    }

    /**
     * 判断一个 Object 是否有效
     * @param obj
     * @returns
     */
    export function isValid(obj: CS.UnityEngine.Object) {
        return IsNullObject(obj) === false;
    }

    /**
     * 根据 template 实例化一个 GameObject
     * @param template
     * @param parent 可选
     * @returns
     */
    export function instantiate(template: GameObjectOrComponent, parent?: GameObjectOrComponent): GameObject {
        if (parent === undefined) {
            return <GameObject>GameObject.Instantiate(template.gameObject);
        } else {
            return <GameObject>GameObject.Instantiate(template.gameObject, parent.transform);
        }
    }

    /**
     * 销毁 GameObject
     * @param obj
     */
    export function destroy(obj: CS.UnityEngine.Object | undefined, delay: number = 0) {
        if (obj) GameObject.Destroy(obj, delay);
    }

    /**
     * 立即销毁 GameObject
     * @param obj
     */
    export function destroyImmediate(obj: CS.UnityEngine.Object | undefined) {
        if (obj) GameObject.DestroyImmediate(obj);
    }

    /**
     * 查找 GameObject
     * @param path
     * @returns
     */
    export function find(path: string): GameObject | undefined {
        let obj = GameObject.Find(path);
        return isNull(obj) ? undefined : obj;
    }

    /**
     * 查找 GameObject （有断言）
     * @param path
     * @returns
     */
    export function get(path: string): GameObject {
        let obj = find(path);
        F.assert(obj, `cannot find GameObject, path:${path}`);
        return obj;
    }

    /**
     * 通过相对路径在 Transform 下查找 component（无断言）
     * @param objOrComp
     * @param path
     * @returns
     */
    export function findComponentWithPath(objOrComp: GameObjectOrComponent, path: string): Transform | undefined;
    export function findComponentWithPath<T extends typeof Component>(objOrComp: GameObjectOrComponent, path: string, type?: T): InstanceType<T> | undefined;
    export function findComponentWithPath<T extends typeof Component>(objOrComp: GameObjectOrComponent, path: string, type?: T): InstanceType<T> | undefined {
        let transform = objOrComp.transform.Find(path);
        return isNull(transform) ? undefined : type === undefined ? (transform as InstanceType<T>) : findComponent(transform, type);
    }

    /**
     * 通过相对路径在 Transform 下查找 component （有断言）
     * @param objOrComp
     * @param path
     * @returns
     */
    export function getComponentWithPath(objOrComp: GameObjectOrComponent, path: string): Transform;
    export function getComponentWithPath<T extends typeof Component>(objOrComp: GameObjectOrComponent, path: string, type?: T): InstanceType<T>;
    export function getComponentWithPath<T extends typeof Component>(objOrComp: GameObjectOrComponent, path: string, type?: T): InstanceType<T> {
        let component = findComponentWithPath(objOrComp, path, type);
        F.assert(component, `cannot find component in [${getObjectPath(objOrComp)}], path:${path}`);
        return component;
    }

    /**
     * 通过相对路径在 Transform 下查找 gameObject（无断言）
     * @param objOrComp
     * @param path
     * @returns
     */
    export function findGameObjectWithPath(objOrComp: GameObjectOrComponent, path: string): CS.UnityEngine.GameObject | undefined {
        return findComponentWithPath(objOrComp, path)?.gameObject;
    }

    /**
     * 通过相对路径在 Transform 下查找 gameObject（有断言）
     * @param objOrComp
     * @param path
     * @returns
     */
    export function getGameObjectWithPath(objOrComp: GameObjectOrComponent, path: string): CS.UnityEngine.GameObject {
        return getComponentWithPath(objOrComp, path).gameObject;
    }

    /**
     * 查找 component（无断言）
     * @param objOrComp
     * @param type
     * @returns
     */
    export function findComponent<T extends typeof Component>(objOrComp: GameObjectOrComponent, type: T): InstanceType<T> | undefined {
        let component = objOrComp.GetComponent(puer.$typeof(type)) as InstanceType<T>;
        return isNull(component) ? undefined : component;
    }

    /**
     * 查找 component（有断言）
     * @param objOrComp
     * @param type
     * @returns
     */
    export function getComponent<T extends typeof Component>(objOrComp: GameObjectOrComponent, type: T): InstanceType<T> {
        let component = findComponent(objOrComp, type);
        F.assert(component, `cannot find component [${type.name}] in [${getObjectPath(objOrComp)}], type: ${type}`);
        return component;
    }

    /**
     * 在 parent 中查找 component（无断言）
     * @param objOrComp
     * @param type
     * @returns
     */
    export function findComponentInParent<T extends typeof Component>(objOrComp: GameObjectOrComponent, type: T): InstanceType<T> | undefined {
        let component = objOrComp.GetComponentInParent(puer.$typeof(type)) as InstanceType<T>;
        return isNull(component) ? undefined : component;
    }

    /**
     * 在 parent 中查找 component（有断言）
     * @param objOrComp
     * @param type
     * @returns
     */
    export function getComponentInParent<T extends typeof Component>(objOrComp: GameObjectOrComponent, type: T): InstanceType<T> {
        let component = findComponentInParent(objOrComp, type);
        F.assert(component, `cannot find component [${type.name}] in parent [${getObjectPath(objOrComp)}], type: ${type}`);
        return component;
    }

    /**
     * 在 children 中查找 component（无断言）
     * @param objOrComp
     * @param type
     * @returns
     */
    export function findComponentInChildren<T extends typeof Component>(objOrComp: GameObjectOrComponent, type: T, includeInactive: boolean = false): InstanceType<T> | undefined {
        let component = objOrComp.GetComponentInChildren(puer.$typeof(type), includeInactive) as InstanceType<T>;
        return isNull(component) ? undefined : component;
    }

    /**
     * 在 children 中查找 component（有断言）
     * @param objOrComp
     * @param type
     * @returns
     */
    export function getComponentInChildren<T extends typeof Component>(objOrComp: GameObjectOrComponent, type: T, includeInactive: boolean = false): InstanceType<T> {
        let component = findComponentInChildren(objOrComp, type, includeInactive);
        F.assert(component, `cannot find component [${type.name}] in children of [${getObjectPath(objOrComp)}], type: ${type}`);
        return component;
    }

    /**
     * 在 children 中查找所有符合的 component
     * @param objOrComp
     * @param type
     * @returns
     */
    export function getComponentsInChildren<T extends typeof Component>(objOrComp: GameObjectOrComponent, type: T, includeInactive: boolean = false): CS.System.Array$1<InstanceType<T>> {
        return objOrComp.GetComponentsInChildren(puer.$typeof(type), includeInactive) as CS.System.Array$1<InstanceType<T>>;
    }

    /**
     * 添加 component
     * @param objOrComp
     * @param type
     * @returns
     */
    export function addComponent<T extends typeof Component>(objOrComp: GameObjectOrComponent, type: T): InstanceType<T> {
        return objOrComp.gameObject.AddComponent(puer.$typeof(type)) as InstanceType<T>;
    }

    /**
     * 查找或添加 component
     * @param objOrComp
     * @param type
     * @returns
     */
    export function findOrAddComponent<T extends typeof Component>(objOrComp: GameObjectOrComponent, type: T): InstanceType<T> {
        let component = findComponent(objOrComp, type);
        return component || addComponent(objOrComp, type);
    }

    /**
     * 销毁 component
     * @param objOrComp
     * @param type
     */
    export function destroyComponent<T extends typeof Component>(objOrComp: GameObjectOrComponent, type: T) {
        let component = findComponent(objOrComp, type);
        if (component) Component.Destroy(component);
    }

    /**
     * 遍历所有子节点
     * @param objOrComp
     * @param callback
     */
    export function foreachChild(objOrComp: GameObjectOrComponent, callback: (child: Transform, index: number) => void) {
        let transform = objOrComp.transform;
        for (let i = 0; i < transform.childCount; i++) {
            callback(transform.GetChild(i), i);
        }
    }

    /**
     * 映射所有子节点
     * @param objOrComp
     * @param callback
     */
    export function mapChildren<T>(objOrComp: GameObjectOrComponent, callback: (child: Transform, index: number) => T): T[] {
        let result: T[] = [];
        foreachChild(objOrComp, (child, index) => result.push(callback(child, index)));
        return result;
    }

    /**
     * 销毁子节点
     * @param objOrComp
     * @param childName 可选，指定名字则只销毁名字匹配的子节点
     */
    export function destroyChildren(objOrComp: GameObjectOrComponent, childName?: string) {
        foreachChild(objOrComp, (child) => (childName === undefined || child.name === childName) && destroy(child.gameObject));
    }

    /**
     * 获取一个 object 的路径
     * @param objOrComp
     * @returns
     */
    export function getObjectPath(objOrComp: GameObjectOrComponent) {
        let path = objOrComp.name;
        while (objOrComp.transform.parent) {
            objOrComp = objOrComp.transform.parent.gameObject;
            path = objOrComp.name + "/" + path;
        }
        return path;
    }
}
