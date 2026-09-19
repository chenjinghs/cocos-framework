import { assert } from "../global/GlobalFunctions.js";
import { Constructor, getManager, IStore, NestedTag, StoreConstructor } from "./Interface.js";

export type RStore = Readonly<Store>;

let maxId = 0;

/**
 * store代理访问类，一般用于检查store是否被有权限的system修改
 */
export class StoreProxy {
    public value?: Store;
}

/**
 * Store基类，树状结构
 */
export class Store implements IStore {
    /**
     * 注册
     * @param this Store类型
     * @param tag 标签
     */
    public static register<T extends typeof Store>(this: T, tag?: string) {
        getManager().registerStore(this, tag);
    }

    /**
     * 创建Store
     * @param this 类型
     * @param parent 父
     * @returns Store实例
     */
    public static create<T extends typeof Store>(this: T, parent: Store | RStore): Readonly<InstanceType<T>> {
        return getManager().createStore(this, parent) as Readonly<InstanceType<T>>;
    }

    /**
     * 删除Store
     * @param store Store实例
     */
    public static destroy(store: Store | RStore) {
        getManager().destroyStore(store);
    }

    /**
     * 根据标签创建Store
     * @param tag 标签
     * @param parent 父
     * @returns Store实例
     */
    public static createByTag(tag: NestedTag, parent: Store | RStore): RStore | RStore[] {
        return getManager().createStoreByTag(tag, parent);
    }

    /**
     * 根据标签删除Store
     * @param tag 标签
     */
    public static destroyByTag(tag: NestedTag) {
        getManager().destroyStoreByTag(tag);
    }

    /**
     * 根据id删除Store
     * @param id Store id
     */
    public static destroyById(id: number) {
        getManager().destroyStoreById(id);
    }

    /**
     * 根据id查找Store
     * @param id Store id
     * @param storeCtor Store类型
     * @returns 找到则返回Store实例否则返回undefined
     */
    public static findById<T extends Store>(id: number, storeCtor?: Constructor<T>): Readonly<T> | undefined {
        let store = getManager().findStoreById(id);
        if (!store) {
            return undefined;
        }
        if (!storeCtor || store.constructor === storeCtor) {
            return store as unknown as Readonly<T>;
        }
        return undefined;
    }

    /**
     * 是否是合法标签
     * @param tag 标签
     * @returns 结果
     */
    public static isValidTag(tag: string): boolean {
        return getManager().isValidStoreTag(tag);
    }

    // //////////////////////////////////////////////////////////
    public parent: Readonly<Store> | null = null;
    public children?: Array<Readonly<Store>>;
    public id: number = 0;

    public constructor(parent: Readonly<Store> | Store | null) {
        this.parent = parent;
        this.id = ++maxId;
    }

    public get tag(): string | undefined {
        return getManager().findStoreTag(this.constructor as StoreConstructor);
    }

    public get valid(): boolean {
        return getManager().findStoreById(this.id) !== undefined;
    }
}

// /////////////////////////////////////////////////////////
/**
 * 单例Store
 */
export class SingletonStore extends Store {
    public static getSingleton<T extends SingletonStore>(this: Constructor<T>): Readonly<T> {
        let ret = getManager().findSingletonStore(this) as Readonly<T>;
        assert(ret, `the SingletonStore is invalid, name: ${this.name}`);
        return ret;
    }
}

// /////////////////////////////////////////////////////////
/**
 * RootStore，所有Store的根
 */
export class RootStore extends Store {}
