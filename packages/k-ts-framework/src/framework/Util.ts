import { assert } from "../global/GlobalFunctions.js";
import { clearUtilLinkerWithSystemCtors } from "../misc/UtilLinker.js";
import { Env } from "./Env.js";
import { Constructor, EEnvType, getManager, IEnvData, StoreConstructor, SystemConstructor } from "./Interface.js";
import { SingletonStore, Store } from "./Store.js";
import { System } from "./System.js";

/**
 * 关于 get 和 find 的区分
 * 1. get 是可以返回明确值的，会做 assert 检查
 * 2. find 不做检查，返回值可能为 undefined
 */

type RStore = Readonly<Store>;
type StoreCtor = typeof Store;

/**
 * 判断一个Store是否有效
 * @param store
 * @returns
 */
export function isValidStore(store: RStore | Store): boolean {
    return store.valid;
}

/**
 * 获取一个ParentStore实例下的ChildrenStore的数量
 * @param parentStore ParentStore实例
 * @returns ChildStore数量
 */
export function getStoreChildrenCount(parentStore: RStore): number {
    return parentStore.children ? parentStore.children.length : 0;
}

/**
 * 根据下标索引获取一个ParentStore下对应的ChildStore实例（如果数组越界会抛出异常）
 * @param parentStore ParentStore实例
 * @param index 待查找的ChildStore下标索引
 * @returns ChildStore实例
 */
export function getStoreChildAt<T extends Store>(parentStore: RStore, index: number): Readonly<T> {
    assert(parentStore.children);
    if (index < 0 || index >= parentStore.children.length) {
        throw new Error("invalid index");
    }
    return parentStore.children[index] as unknown as Readonly<T>;
}

/**
 * 迭代一个ParentStore下的所有ChildStore实例
 * @param parentStore ParentStore实例
 * @param callback 回调函数
 * @param thisArg 回调函数的this指针
 */
export function iterateStoreChildren(parentStore: RStore, callback: (value: RStore, index: number) => void, thisArg?: any) {
    assert(parentStore.children);
    parentStore.children.forEach(callback, thisArg);
}

/**
 * 获取一个Store的ParentStore
 * @param store
 * @returns
 */
export function getStoreParent<T extends Store>(store: RStore): Readonly<T> {
    assert(store.parent, "invalid store");
    return store.parent as unknown as Readonly<T>;
}

/**
 * 获取一个Store的Owner构造器（通常是一个SystemCtor）
 * @param store
 * @returns
 */
export function getStoreOwnerCtor(store: RStore): SystemConstructor | undefined {
    return getManager().getStoreOwnerCtor(store.constructor as StoreConstructor);
}

/**
 * 通过StoreCtor获取一个Store与之同一个Parent下所有ChildStore实例
 * @param store
 * @param storeCtor
 * @returns
 */
export function findStoreSiblings<T extends StoreCtor>(store: RStore, storeCtor: T): Readonly<InstanceType<T>>[] {
    assert(isValidStore(store));
    return findStoreChildrenByCtor<T>(getStoreParent(store), storeCtor);
}

/**
 * 通过StoreCtor获取一个Store与之同一个Parent下ChildStore实例
 * @param store
 * @param storeCtor
 * @returns
 */
export function findStoreSibling<T extends StoreCtor>(store: RStore, storeCtor: T): Readonly<InstanceType<T>> | undefined {
    assert(isValidStore(store));
    return findStoreChildByCtor<T>(getStoreParent(store), storeCtor);
}

/**
 * 查找一个Store下所有指定Ctor类型的ChildStore实例
 * @param store
 * @param storeCtor
 * @returns
 */
export function findStoreChildrenByCtor<T extends StoreCtor>(store: RStore, storeCtor: T): Readonly<InstanceType<T>>[] {
    let ret = [];
    if (store.children) {
        for (let v of store.children) {
            if (v.constructor === storeCtor) {
                ret.push(v as unknown as Readonly<InstanceType<T>>);
            }
        }
    }
    return ret;
}

/**
 * 查找一个Store下指定Ctor类型的ChildStore实例
 * @param store
 * @param storeCtor
 * @returns
 */
export function findStoreChildByCtor<T extends StoreCtor>(store: RStore, storeCtor: T): Readonly<InstanceType<T>> | undefined {
    if (store.children) {
        for (let v of store.children) {
            if (v.constructor === storeCtor) {
                return v as unknown as Readonly<InstanceType<T>>;
            }
        }
    }
    return undefined;
}

/**
 * 查找一个Store下带有指定Tag的所有ChildrenStore实例
 * @param store
 * @param tag
 * @returns
 */
export function findStoreChildrenByTag<T extends Store>(store: RStore, tag: string): Readonly<T>[] {
    if (store.children) {
        let result = [];
        for (let v of store.children) {
            if (v.tag === tag) {
                result.push(v);
            }
        }
        return result as unknown as Readonly<T>[];
    }
    return [];
}

/**
 * 查找一个Store下带有指定Tag的ChildStore实例（返回第一个）
 * @param store
 * @param tag
 * @returns
 */
export function findStoreChildByTag<T extends Store>(store: RStore, tag: string): Readonly<T> | undefined {
    let stores = findStoreChildrenByTag<T>(store, tag);
    return stores[0];
}

/**
 * 查找所有带有指定Tag的Store实例，如果需要强制类型检查，请使用findStoresByTagWithTypeCheck
 * @param tag
 * @returns
 */
export function findStoresByTag<T extends Store>(tag: string): Readonly<T>[] {
    return getManager().findStoreByTag(tag) as Readonly<T>[];
}

/**
 * 查找所有带有指定Tag的Store实例,强制类型检查，只要数组中有一项不符合指定类型，返回[]
 * @param tag
 * @returns
 */
export function findStoresByTagWithTypeCheck<T extends Store>(tag: string, type: Constructor<T>): Readonly<T>[] {
    let instances = getManager().findStoreByTag(tag);
    for (const instance of instances) {
        if (instance.constructor !== type) {
            return [];
        }
    }
    return instances as Readonly<T>[];
}

/**
 * 查找带有指定Tag的Store实例(返回第一个)，如果需要强制类型检查，请使用findStoreByTagWithTypeCheck
 * @param tag
 * @returns
 */
export function findStoreByTag<T extends Store>(tag: string): Readonly<T> | undefined {
    let stores = findStoresByTag<T>(tag);
    return stores[0];
}

/**
 * 查找带有指定Tag的Store实例(返回第一个)，如果需要强制类型检查，请使用findStoreByTagWithTypeCheck（带查找失败 Assert）
 * @param tag
 * @returns
 */
export function getStoreByTag<T extends Store>(tag: string): Readonly<T> {
    let store = findStoreByTag<T>(tag);
    assert(store, `can not find store by tag ${tag}`);
    return store;
}

/**
 * 查找带有指定Tag的Store实例(返回第一个),强制带类型检查
 * @param tag
 * @returns
 */
export function findStoreByTagWithTypeCheck<T extends Store>(tag: string, type: Constructor<T>): Readonly<T> | undefined {
    let stores = findStoresByTag<T>(tag);
    if (stores.length > 0) {
        // 类型判断
        if (!type || stores[0].constructor === type) return stores[0];
    }

    return undefined;
}

/**
 * 查找带有指定id的Store实例，如果需要强制类型检查，请使用findStoreByIdWithTypeCheck
 * @param id
 * @returns
 */
export function findStoreById<T extends Store>(id: number): Readonly<T> | undefined {
    return Store.findById<T>(id);
}

/**
 * 查找带有指定id的Store实例,强制带类型检查
 * @param id
 * @returns
 */
export function findStoreByIdWithTypeCheck<T extends Store>(id: number, type: Constructor<T>): Readonly<T> | undefined {
    return Store.findById<T>(id, type);
}

/**
 * 删除带有指定id的Store实例
 * @param id
 */
export function destroyStoreById(id: number) {
    Store.destroyById(id);
}

/**
 * 查找单例Store
 * @param ctor Store类型
 * @returns 实例或者空
 */
export function findSingletonStore<T extends SingletonStore>(ctor: Constructor<T>): Readonly<T> | undefined {
    return getManager().findSingletonStore(ctor) as Readonly<T>;
}

/**
 * 根据类型查找Store数组
 * @param ctor Store类型
 * @returns 实例数组或者空
 */
export function findStoresByCtor<T extends Store>(ctor: Constructor<T>): Readonly<T>[] {
    return getManager().findStoresByCtor(ctor) as Readonly<T>[];
}

/**
 * 根据类型查找Store
 * @param ctor Store类型
 * @returns 实例或者空
 */
export function findStoreByCtor<T extends Store>(ctor: Constructor<T>): Readonly<T> | undefined {
    let result = getManager().findStoresByCtor(ctor);
    if (!result || !(result[0] instanceof ctor)) return;
    return result[0] as Readonly<T>;
}

/**
 * 根据类型查找Store
 * @param ctor Store类型
 * @returns 实例或者空
 */
export function getStoreByCtor<T extends Store>(ctor: Constructor<T>): Readonly<T> {
    let store = findStoreByCtor<T>(ctor);
    assert(store, `can not find store by ctor ${ctor.name}`);
    return store;
}

const nameGetterProxy = new Proxy({} as any, {
    get: function (_obj, propertyName) {
        return propertyName;
    },
});

/**
 * 获取根Root
 * @returns
 */
export function getRootStore(): Readonly<Store> {
    return getManager().getRootStore();
}

/**
 * 设置单例store的默认父store
 * @param store
 */
export function setDefaultSingletonParentStore(store: Readonly<Store>) {
    getManager().setDefaultSingletonParentStore(store);
}

/**
 * 获取单例store默认父store
 * @returns
 */
export function getDefaultSingletonParentStore<T extends Store>(): Readonly<T> {
    return getManager().getDefaultSingletonParentStore() as T;
}

/**
 * 该接口用于获取对应类型变量的 Key，会将 Key 直接返回
 * @param ctor
 * @returns
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function keyGetter<T extends Constructor>(ctor: T): { [P in keyof InstanceType<T>]: keyof InstanceType<T> } {
    return nameGetterProxy;
}

/**
 * 是否是Client环境
 * @returns
 */
export function isClient() {
    return (Env.current.type & EEnvType.Client) !== 0;
}

/**
 * 是否是DedicatedServer环境
 * @returns
 */
export function isDedicatedServer() {
    return (Env.currentType & EEnvType.BattleServer) !== 0;
}

/**
 * 是否是单机服务器环境
 * @returns
 */
export function isStandaloneServer() {
    return (Env.currentType & EEnvType.StandaloneServer) !== 0;
}

/**
 * 是否是单机服务器或者联网服务器环境
 * @returns
 */
export function isServerLogic() {
    return (Env.currentType & EEnvType.ServerLogic) !== 0;
}

// 全开runtime无法排除不用的，所以这里注掉了，走单个创建
// let systemDefaultKeys = new Set<string>(Object.getOwnPropertyNames(System.prototype));
// type PickMethods<T> = Pick<T, { [K in keyof T]: T[K] extends Function ? K : never }[keyof T]>;
// type PickMethodsWithoutSystem<T> = Omit<PickMethods<T>, keyof PickMethods<System>>;

// /**
//  * 根据传入的System类型生成Util帮助类
//  * @param ctor System类型
//  * @returns Util类，含有所有System public方法
//  */
// export function createUtil<T extends System>(ctor: Constructor<T>): PickMethodsWithoutSystem<T> {
//     let ret = {} as any;
//     Object.getOwnPropertyNames(ctor.prototype).forEach((propertyName: string) => {
//         if (systemDefaultKeys.has(propertyName)) return;

//         let desc = Object.getOwnPropertyDescriptor(a.prototype, propertyName);
//         if (typeof desc!.value !== "function") return;

//         ret[propertyName] = (...args: any[]): any => {
//             let system = getManager().findSystem(ctor);
//             F.assert(system, `system can not be accessed, name: ${ctor.name}, function: ${propertyName}`);

//             return desc!.value(...args);
//         };
//     });
//     return ret;
// }

/**
 * @deprecated
 * 创建Util帮助函数，只支持非静态函数，静态函数请直接导出即可
 * @param ctor System类型
 * @param funcName 函数名
 * @returns 生成的Util函数，类型与System同名函数一致
 */
export function createUtilFunction<T extends System, TFuncName extends keyof Omit<T, keyof System>, TReturnType extends Omit<T, keyof System>[TFuncName]>(
    ctor: Constructor<T>,
    funcName: TFuncName,
): TReturnType {
    let func = Object.getOwnPropertyDescriptor(ctor.prototype, funcName)?.value;
    assert(typeof func === "function", `util function create failed, can not find function ${String(funcName)} in ${ctor.name}`);

    let ret = (...args: any[]): any => {
        let system = getManager().findSystem(ctor);
        assert(system, `system can not be accessed, name: ${ctor.name}, function: ${String(funcName)}`);

        return func.call(system, ...args);
    };
    return ret as unknown as TReturnType;
}

/**
 * symbol的存储结构，跟着env走
 */
class SymbolWithObjectEnvData implements IEnvData {
    public symbols = new WeakMap<object, Array<symbol>>();
    public inheritFrom(_source: SymbolWithObjectEnvData): void {
        // Do nothing
    }
}

/**
 * 根据传入的object创建symbol
 * @param obj object
 * @param description 描述
 * @returns symbol
 */
export function createSymbolWithObject(obj: object, description?: string | number) {
    let ret = Symbol(description);
    let symbols = Env.getCurrentData(SymbolWithObjectEnvData).symbols;
    let found = symbols.get(obj);
    if (found === undefined) {
        found = new Array<symbol>();
        symbols.set(obj, found);
    }
    found.push(ret);
    return ret;
}

/**
 * 根据object删除symbol
 * @param obj object
 */
export function destroySymbolsWithObject(obj: object) {
    let symbols = Env.getCurrentData(SymbolWithObjectEnvData).symbols;
    let found = symbols.get(obj);
    if (found !== undefined) symbols.delete(obj);
}

/**
 * 根据object查找symbol
 * @param obj object
 * @returns 找到的symbol
 */
export function findSymbolsWithObject(obj: object) {
    return Env.getCurrentData(SymbolWithObjectEnvData).symbols.get(obj);
}

/**
 * 绑定object和symbol
 * @param obj
 * @param symbol
 */
export function bindSymbolWithObject(obj: object, symbol: symbol) {
    let symbols = Env.getCurrentData(SymbolWithObjectEnvData).symbols;
    let found = symbols.get(obj);
    if (found === undefined) {
        found = new Array<symbol>();
        symbols.set(obj, found);
    }

    if (found.indexOf(symbol) < 0) found.push(symbol);
    return symbol;
}

/**
 * 获取当前promise堆栈信息
 * @returns Promise堆栈信息
 */
// export function getCurrentPromiseStackInfo() {
//     return SubscribeHelper.getCurrentAsyncStackInfo();
// }

/**
 * 生成当前env的store tree 描述json object
 * @param tag 不指定则从RootStore开始
 * @returns obj
 */
export function generateStoreTreeJsonObjectInCurrentEnv(tag?: string) {
    let rootStores;
    if (tag !== undefined && tag.length > 0 && tag !== "root") {
        rootStores = findStoresByTag(tag);
    } else {
        rootStores = getRootStore();
    }

    let collect = function (store: Readonly<Store>): any {
        let retObj;
        let children = store.children;
        let totalCount = 0;
        let desc;

        if (!store.valid) {
            retObj = undefined;
            desc = `invalid`;
        } else if (!children || children!.length === 0) {
            retObj = [];
            desc = "no children";
        } else {
            retObj = [];
            totalCount += children.length;
            for (let v of children) {
                let [childObj, childName, childTotalCount] = collect(v);
                totalCount += childTotalCount;
                let wrapper = {};
                retObj.push(wrapper);

                Object.defineProperty(wrapper, childName, {
                    value: childObj ?? [],
                    writable: false,
                    enumerable: true,
                    configurable: true,
                });
            }
            desc = `total: ${totalCount}, children: ${children.length}`;
        }

        return [retObj, `${store.constructor.name} (id: ${store.id}, ${desc})`, totalCount];
    };

    let jsonRoot = {};
    if (Array.isArray(rootStores)) {
        for (let v of rootStores) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            let [rootObj, rootName, _totalCount] = collect(v);
            Object.defineProperty(jsonRoot, rootName, {
                value: rootObj ?? [],
                writable: false,
                enumerable: true,
                configurable: true,
            });
        }
    } else {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        let [rootObj, rootName, _totalCount] = collect(rootStores);
        Object.defineProperty(jsonRoot, rootName, {
            value: rootObj ?? [],
            writable: false,
            enumerable: true,
            configurable: true,
        });
    }

    return jsonRoot;
}

/**
 * 生成当前env的store tree 描述json
 * @param tag 不指定则从RootStore开始
 * @returns
 */
export function generateStoreTreeJsonInCurrentEnv(tag?: string) {
    let jsonRoot = generateStoreTreeJsonObjectInCurrentEnv(tag);
    return JSON.stringify(jsonRoot);
}

/**
 * 生成所有env下的store tree描述json
 * @param tag 不指定则从RootStore开始
 * @param envName 不指定则打印所有Env下的信息
 */
export function generateStoreTreeJsonInEnv(tag?: string, envName?: string) {
    let allEnvs;
    if (envName && envName.length > 0) {
        let env = Env.findByName(envName);
        if (!env) return `can not found env ${envName}`;
        allEnvs = [env];
    } else {
        allEnvs = Env.getAllEnvInfo();
        if (allEnvs.length === 0) allEnvs = [Env.current];
    }

    let envObjects = {};
    allEnvs.forEach((v) => {
        Env.scope(v, () => {
            let jsonRoot = generateStoreTreeJsonObjectInCurrentEnv(tag);
            let name = `env (${v.name})`;
            Object.defineProperty(envObjects, name, {
                value: jsonRoot ?? [],
                writable: false,
                enumerable: true,
                configurable: true,
            });
        });
    });
    return JSON.stringify(envObjects);
}

/**
 * 通过 Tag 创建 Store 的同时，创建其 Tag 关联的 System
 * @param tag
 * @param parent
 * @returns
 */
export function createSSWithTag(tag: string, parent: RStore) {
    findStoresByTag(tag).length <= 0 && System.createByTag(tag);
    return Store.createByTag(tag, parent);
}

/**
 * 通过 StoreCtor 创建 Store 的同时，创建其 Tag 关联的 System
 * @param tag
 * @param parent
 * @returns
 */
export function createSSWithStore(storeCtor: typeof Store, parent: RStore) {
    const tag = getManager().findStoreTag(storeCtor);
    // Store 可能没有 tag
    tag && findStoresByTag(tag).length <= 0 && System.createByTag(tag);
    return storeCtor.create(parent);
}

/**
 * 销毁 Store 的同时，销毁其 Tag 关联的 System
 * @param tag
 * @param parent
 * @returns
 */
export function destroySS(store: RStore) {
    const tag = store.tag;
    Store.destroy(store);
    // Store 可能没有 tag
    tag && destroySystemIfNotUsed(tag);
}

/**
 * 销毁未被使用的 System
 * @param tag
 */
export function destroySystemIfNotUsed(tag: string) {
    findStoresByTag(tag).length <= 0 && System.destroyByTag(tag);
}

/**
 * 销毁 Tag 关联的所有 Store 和 System
 * @param tag
 */
export function destroySSWithTag(tag: string) {
    const stores = findStoresByTag(tag);
    if (stores.length <= 0) return;
    stores.forEach(Store.destroy);
    System.destroyByTag(tag);
}

/**
 * 判断系统在不在
 * @param tag
 * @returns
 */
export function hasSystemExisted(tagOrCtor: string | SystemConstructor) {
    if (typeof tagOrCtor === "string") {
        return getManager().findSystemsByTag(tagOrCtor).length > 0;
    } else {
        return getManager().findSystem(tagOrCtor) !== undefined;
    }
}

/**
 * 卸载注册的system信息
 * @param tag
 */
export function unregisterSystem(tagOrCtor: string | SystemConstructor) {
    assert(!hasSystemExisted(tagOrCtor), `system ${tagOrCtor} instance is still existed`);

    let systemCtors = getManager().unregisterSystem(tagOrCtor);
    clearUtilLinkerWithSystemCtors(systemCtors);
}

/**
 * 判断 Store 在不在
 * @param tag
 * @returns
 */
export function hasStoreExisted(tagOrCtor: string | StoreConstructor) {
    if (typeof tagOrCtor === "string") {
        return findStoresByTag(tagOrCtor).length > 0;
    } else {
        return findStoreByCtor(tagOrCtor) !== undefined;
    }
}

/**
 * 卸载注册的store信息
 * @param tag
 * @returns
 */
export function unregisterStore(tagOrCtor: string | StoreConstructor) {
    assert(!hasStoreExisted(tagOrCtor), `store ${tagOrCtor} instance is still existed`);

    getManager().unregisterStore(tagOrCtor);
}
