/* eslint-disable @typescript-eslint/member-ordering */
import { assert, isChildOf } from "../global/GlobalFunctions";
import { HookType, HookUtil } from "../misc/HookDefine";
import { RuntimeContext } from "../misc/RuntimeContext";
import { SubscribeHelper } from "../misc/Subscriber";
import { TagHelper } from "../misc/TagHelper";
import { Env } from "./Env";
import { Constructor, EDataInheritType, IEnvData, IManager, IStore, ISubscribeHelper, ISystem, ISystemWrapper, NestedTag, RIStore, setManager, StoreConstructor, SystemConstructor } from "./Interface";
import { RootStore, SingletonStore, StoreProxy } from "./Store";

/**
 * 存储所有store相关的信息
 */
class StoreData {
    public ctors = new Set<StoreConstructor>();
    public tagHelper = new TagHelper();
    public idToInstance: Map<number, IStore> = new Map<number, IStore>();
    public ctorToInstances = new Map<StoreConstructor, Array<IStore>>();
    public rootStore!: IStore;
    public proxy = new StoreProxy();
    public storeToProxy?: Map<IStore, IStore>;
    public systemOwnerToStores = new Map<SystemConstructor, Set<StoreConstructor>>();
    public storeToSystemOwners = new Map<StoreConstructor, SystemConstructor>();
    public singletons = new Map<StoreConstructor, IStore>();
    public singletonParentStore!: IStore;

    public constructor() {
        this.tagHelper.setVerifyTagFunc((tag) => HookUtil.triggerHook(HookType.onStoreVerifyTag, tag));
    }

    public inheritFrom(source: StoreData, dataInheritType: EDataInheritType) {
        this.tagHelper.inheritFrom(source.tagHelper);

        if (dataInheritType & EDataInheritType.StaticData) {
            source.ctors.forEach((v) => {
                this.ctors.add(v);
            });
            source.systemOwnerToStores.forEach((v, k) => {
                this.systemOwnerToStores.set(k, new Set(v));
            });
            source.storeToSystemOwners.forEach((v, k) => {
                this.storeToSystemOwners.set(k, v);
            });
        }
    }
}

/**
 * system实例信息
 * reload把这个换掉就行了
 * system内部无数据，都存在此
 */
class SystemInstanceInfo implements ISystemWrapper {
    public static maxOrder = 0;

    public system: ISystem | undefined;
    public subscribeHelper: SubscribeHelper;
    public order: number = 0; // 初始化时的顺序，destroyAll时会按照个反向操作

    public constructor(system: ISystem) {
        this.system = system;
        this.subscribeHelper = new SubscribeHelper();
        this.order = ++SystemInstanceInfo.maxOrder;
    }
}

/**
 * 存储所有system相关的信息
 */
class SystemData {
    // 这里存的instance是SystemInstanceInfo，并不是system，这么做为了方便reload以及管理system的引用关系
    public tagHelper = new TagHelper();
    // public friends = new Map<SystemConstructor, string>();
    public systems = new Map<SystemConstructor, SystemInstanceInfo>();

    public constructor() {
        this.tagHelper.setVerifyTagFunc((tag) => HookUtil.triggerHook(HookType.onSystemVerifyTag, tag));
    }

    public inheritFrom(source: SystemData, _dataInheritType: EDataInheritType) {
        this.tagHelper.inheritFrom(source.tagHelper);

        // if (dataInheritType & EDataInheritType.StaticData) {
        //     this.friends = new Map<SystemConstructor, string>(source.friends);
        // }
    }
}

/**
 * 全部数据
 */
class Data implements IEnvData {
    public storeData = new StoreData();
    public systemData = new SystemData();

    public inheritFrom(source: Data, dataInheritType?: EDataInheritType) {
        this.storeData.inheritFrom(source.storeData, dataInheritType!);
        this.systemData.inheritFrom(source.systemData, dataInheritType!);
    }
}

function parseNestedTag(nestedTag: NestedTag): string | string[] {
    const impl = (tag: NestedTag): string[] => (typeof tag === "string" ? [tag] : tag.flatMap(impl));
    const tags = impl(nestedTag);
    assert(tags.length > 0, "tag is invalid");
    return tags.length === 1 ? tags[0] : tags;
}

// //////////////////////////////////////////////////////////////////////////////////////////////
/**
 * 处理system和store的各种逻辑，最终把数据写回到data中
 */
class Manager implements IManager {
    public onEnvInit(env: Env, dispatchEvent: boolean): void {
        let storeData = env.getData(Data).storeData;
        storeData.rootStore = this.createStoreImp(storeData, RootStore, null, dispatchEvent);
        this.setDefaultSingletonParentStore(storeData.rootStore);
    }

    public onEnvUninit(env: Env): void {
        let storeData = env.getData(Data).storeData;
        this.destroyAllSystems();
        this.destroyStore(storeData.rootStore);
    }

    // //////////////////////////////////////////////////////////////////////////////////////////////
    public registerStore<T extends StoreConstructor>(storeCtor: T, tag?: string) {
        let data = Env.getCurrentData(Data).storeData;

        assert(storeCtor, "register failed, the store ctor must be valid");
        assert(!data.ctors.has(storeCtor), `register failed, duplicated store name [${storeCtor.name}]`);

        data.ctors.add(storeCtor);

        if (tag) {
            data.tagHelper.register(tag, storeCtor);
        }

        HookUtil.triggerHook(HookType.onStoreRegister, storeCtor, tag);
    }

    public createStore<T extends StoreConstructor>(storeCtor: T, parent: IStore | RIStore): IStore {
        assert(!isChildOf(storeCtor, SingletonStore), `can not create singleton store ${storeCtor.name} manually`);
        let data = Env.getCurrentData(Data).storeData;
        return this.createStoreImp(data, storeCtor, parent);
    }

    public createStoreByTag(nestedTag: NestedTag, parent: IStore | RIStore): RIStore | RIStore[] {
        let tag = parseNestedTag(nestedTag);
        let data = Env.getCurrentData(Data).storeData;

        let ctors: StoreConstructor | StoreConstructor[] | undefined;
        let tagHelper = data.tagHelper;
        if (Array.isArray(tag)) {
            for (const v of tag) {
                ctors = tagHelper.addInfos(ctors, tagHelper.findCtorsByTag(v));
            }
        } else {
            ctors = tagHelper.addInfos(ctors, tagHelper.findCtorsByTag(tag));
        }

        assert(ctors, `can not find tagged store type [${tag}]`);

        if (Array.isArray(ctors)) {
            let ret = new Array<RIStore>();
            for (const v of ctors) {
                assert(!isChildOf(v, SingletonStore), `can not create singleton store ${v.name} manually`);
                ret.push(this.createStoreImp(data, v, parent));
            }
            return ret;
        } else {
            assert(!isChildOf(ctors, SingletonStore), `can not create singleton store ${ctors.name} manually`);
            return this.createStoreImp(data, ctors, parent);
        }
    }

    public createStoreImp(data: StoreData, storeCtor: StoreConstructor, parent: IStore | RIStore | null, dispatchEvent = true): IStore {
        let newStore = new storeCtor(parent);
        HookUtil.triggerHook(HookType.onStorePostCreate, newStore, data.proxy);

        let ret = newStore;
        if (data.proxy.value) {
            ret = data.proxy.value;
            data.proxy.value = undefined;

            if (!data.storeToProxy) data.storeToProxy = new Map<IStore, IStore>();
            data.storeToProxy.set(ret, newStore);
        }

        // 都处理下
        assert(!data.idToInstance.has(ret.id), "store id is repeated");
        data.tagHelper.addInstance(ret);
        data.idToInstance.set(ret.id, ret);

        let instances: Array<IStore> | undefined = data.ctorToInstances.get(storeCtor);
        if (!instances) {
            instances = new Array<IStore>();
            data.ctorToInstances.set(storeCtor, instances);
        }
        instances.push(ret);

        if (parent) {
            this.addStoreChild(parent as IStore, ret);
        }

        if (dispatchEvent) RuntimeContext.dispatchStoreCreateSEvent(ret);
        return ret;
    }

    public destroyStore(store: IStore) {
        assert(!(store instanceof SingletonStore), `can not destroy singleton store ${store.constructor.name} manually`);
        let data = Env.getCurrentData(Data).storeData;
        this.destroyStoreImp(data, store);
    }

    public destroyStoreByTag(nestedTag: NestedTag) {
        let tag = parseNestedTag(nestedTag);
        if (Array.isArray(tag)) {
            let count = tag.length;
            for (let i = count - 1; i >= 0; i--) {
                this.destroyStoreByTag(tag[i]);
            }
            return;
        }

        let data = Env.getCurrentData(Data).storeData;
        let tagHelper = data.tagHelper;
        let instances = tagHelper.findInstancesByTag(tag);
        if (!instances) return;

        let instanceCount = instances.length;
        if (instanceCount === 0) {
            return;
        } else if (instanceCount === 1) {
            let toBeDestroyed = instances[0];
            assert(!(toBeDestroyed instanceof SingletonStore), `can not destroy singleton store ${toBeDestroyed.constructor.name} manually`);
            this.destroyStoreImp(data, toBeDestroyed);
        } else {
            let toBeDestroyed = [...instances];
            for (let i = instanceCount - 1; i >= 0; i--) {
                assert(!(toBeDestroyed[i] instanceof SingletonStore), `can not destroy singleton store ${toBeDestroyed[i].constructor.name} manually`);
                this.destroyStoreImp(data, toBeDestroyed[i]);
            }
        }
    }

    public destroyStoreById(id: number) {
        let data = Env.getCurrentData(Data).storeData;
        let store = data.idToInstance.get(id);
        if (store) {
            this.destroyStoreImp(data, store);
        }
    }

    public destroyStoreImp(data: StoreData, store: IStore) {
        if (store.parent === null) {
            return;
        }

        HookUtil.triggerHook(HookType.onStorePreDestroy, store);
        RuntimeContext.dispatchStoreDestroySEvent(store);
        if (data.singletons.get(store.constructor as StoreConstructor) === store) {
            data.singletons.delete(store.constructor as StoreConstructor);
        }

        if (store.children) {
            let children = store.children;
            store.children = undefined;
            let count = children.length;
            for (let i = count - 1; i >= 0; i--) {
                this.destroyStoreImp(data, children[i]);
            }
        }

        // 处理proxy时要注意下
        let realStore = data.storeToProxy?.get(store) || store;
        if (store.parent) {
            this.removeStoreChild(store.parent, realStore);
            realStore.parent = null;
        }
        data.tagHelper.removeInstance(realStore);

        data.idToInstance.delete(store.id);

        let storeCtor = (realStore as any).constructor;
        let instances: Array<IStore> | undefined = data.ctorToInstances.get(storeCtor);
        if (instances) {
            let index = instances.indexOf(store);
            assert(index >= 0);
            instances.splice(index, 1);
            if (instances.length === 0) data.ctorToInstances.delete(storeCtor);
        }

        if (data.storeToProxy) data.storeToProxy.delete(store);
    }

    public findStoreById(id: number): IStore | undefined {
        let data = Env.getCurrentData(Data).storeData;
        return data.idToInstance.get(id);
    }

    public findStoreByTag(tag: string): IStore[] {
        let data = Env.getCurrentData(Data).storeData;
        return data.tagHelper.findInstancesByTag(tag) ?? [];
    }

    public findStoreTag(storeCtor: StoreConstructor): string | undefined {
        let data = Env.getCurrentData(Data).storeData;
        return data.tagHelper.getTag(storeCtor);
    }

    public findStoresByCtor(storeCtor: StoreConstructor): IStore[] {
        let data = Env.getCurrentData(Data).storeData;
        return data.ctorToInstances.get(storeCtor) ?? [];
    }

    public isValidStoreTag(tag: string): boolean {
        let data = Env.getCurrentData(Data).storeData;
        return !!data.tagHelper.findCtorsByTag(tag);
    }

    public getRootStore(): IStore {
        return Env.getCurrentData(Data).storeData.rootStore;
    }

    public findSingletonStore(storeCtor: StoreConstructor): IStore | undefined {
        assert(storeCtor);
        let ret = Env.getCurrentData(Data).storeData.singletons.get(storeCtor);

        if (!ret && storeCtor.prototype.__sharedWithEnv) {
            let current = Env.current;
            for (let env of Env.getAllEnvInfo()) {
                if (env !== current) {
                    ret = env.getData(Data).storeData.singletons.get(storeCtor);
                    if (ret) break;
                }
            }
        }
        return ret;
    }

    public setSharedSingletonStore(storeCtor: StoreConstructor) {
        assert(storeCtor);
        storeCtor.prototype.__sharedWithEnv = true;
    }

    public getStoreOwnerCtor(storeCtor: StoreConstructor): SystemConstructor | undefined {
        let data = Env.getCurrentData(Data).storeData;
        return data.storeToSystemOwners.get(storeCtor);
    }

    public setDefaultSingletonParentStore(store: IStore) {
        let data = Env.getCurrentData(Data).storeData;
        let realStore = data.idToInstance.get(store.id);
        assert(realStore, `invalid singleton parent store ${store.constructor.name}`);
        data.singletonParentStore = realStore;
    }

    public getDefaultSingletonParentStore() {
        let data = Env.getCurrentData(Data).storeData;
        return data.singletonParentStore;
    }

    // ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    private setStoreOwner(storeCtor: StoreConstructor, ownerCtor: SystemConstructor) {
        let data = Env.getCurrentData(Data).storeData;
        assert(data.ctors.has(storeCtor), `set store owner failed, the store [${storeCtor.name}] has not been registered`);

        let storeCtors = data.systemOwnerToStores.get(ownerCtor);
        if (!storeCtors) {
            storeCtors = new Set<StoreConstructor>();
            data.systemOwnerToStores.set(ownerCtor, storeCtors);
        }
        storeCtors.add(storeCtor);
        data.storeToSystemOwners.set(storeCtor, ownerCtor);
    }

    private addStoreChild(parent: IStore, child: IStore) {
        if (!parent.children) {
            parent.children = new Array<IStore>();
        }
        let index = parent.children.findIndex((c: IStore) => {
            return c.id === child.id;
        });
        assert(index < 0);
        parent.children.push(child);
    }

    private removeStoreChild(parent: IStore, child: IStore) {
        if (parent.children) {
            let index = parent.children.findIndex((c: IStore) => {
                return c.id === child.id;
            });
            assert(index >= 0);
            parent.children.splice(index, 1);
        }
    }

    private createSingletonStores(owner: SystemConstructor) {
        let data = Env.getCurrentData(Data).storeData;
        let storeCtors = data.systemOwnerToStores.get(owner);
        if (!storeCtors) return;

        let singletonParentStore = data.singletonParentStore;
        assert(singletonParentStore.valid, `default singleton parent store ${singletonParentStore.constructor.name} is invalid`);

        for (const ctor of storeCtors) {
            if (ctor.prototype instanceof SingletonStore) {
                let newStore = this.createStoreImp(data, ctor, singletonParentStore);
                data.singletons.set(ctor, newStore);
            }
        }
    }

    private destroySingletonStores(owner: SystemConstructor) {
        let data = Env.getCurrentData(Data).storeData;
        let storeCtors = data.systemOwnerToStores.get(owner);
        if (!storeCtors) return;

        // TODO: 这里删除时序和创建时不一样，不知道会有什么隐患
        for (const v of storeCtors) {
            let singleton = data.singletons.get(v);
            if (singleton) this.destroyStoreImp(data, singleton);
        }
    }

    // ////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
    public registerSystem(systemCtor: SystemConstructor, tag: string, stores?: StoreConstructor | StoreConstructor[], envType?: number) {
        let data: SystemData;
        if (
            !Env.scope(envType ?? Env.current, () => {
                data = Env.getCurrentData(Data).systemData;
            })
        ) {
            return;
        }

        data!.tagHelper.register(tag, systemCtor);

        if (stores) {
            if (Array.isArray(stores)) {
                for (const s of stores) this.setStoreOwner(s, systemCtor);
            } else {
                this.setStoreOwner(stores, systemCtor);
            }
        }

        HookUtil.triggerHook(HookType.onSystemRegister, systemCtor, tag, stores, envType);
    }

    // public registerSystemFriend(systemCtor: SystemConstructor, tag: string) {
    //     let data = Env.getCurrentData(Data).systemData;
    //     assert(!data.friends.has(systemCtor), `the system ${systemCtor.name} must have only one friend`);
    //     data.friends.set(systemCtor, tag);
    // }

    public createSystemByTag(nestedTag: NestedTag): boolean {
        let tag = parseNestedTag(nestedTag);
        if (Array.isArray(tag)) {
            return tag.every((v) => {
                return this.createSystemByTag(v);
            });
        }

        let data = Env.getCurrentData(Data).systemData;
        let info = data.tagHelper.findInfoByTag(tag);
        if (!info) {
            console.warn(`system ${tag} has no registers.`);
            return true;
        }

        let ctors = info.ctors;
        if (info.instances.length > 0) {
            let diffCtors: Constructor[] | undefined;
            if (Array.isArray(ctors)) {
                // 检查ctors和instance是否对应，如果少则进行创建
                for (let ctor of ctors) {
                    if (info.instances.findIndex((v) => v.system.constructor === ctor) < 0) {
                        // 新增的
                        if (!diffCtors) diffCtors = [];
                        diffCtors.push(ctor);
                    }
                }
            }

            if (diffCtors === undefined) {
                console.warn(`system ${tag} has been inited.`);
                return true;
            } else {
                ctors = diffCtors;
            }
        }

        console.log("create system by tag: " + tag);

        // new system instance info
        let instances = info.instances;
        let startIndex = instances.length;

        if (Array.isArray(ctors)) {
            for (const ctor of ctors) {
                instances.push(new SystemInstanceInfo(new ctor()));
            }
        } else {
            let ctor = ctors;
            instances.push(new SystemInstanceInfo(new ctor()));
        }

        // 为保证完整性， 下面三道流程特意分开写
        let length = instances.length;
        for (let i = startIndex; i < length; ++i) {
            this.onCreateSystem(data, instances[i]);
        }

        // init
        for (let i = startIndex; i < length; ++i) {
            if (instances[i].system.init() === false) {
                throw new Error(`system ${instances[i].system.constructor.name} init failed`);
            }
        }

        // post init
        let instanceInfo;
        for (let i = startIndex; i < length; ++i) {
            instanceInfo = instances[i];
            // 这里考虑到有可能init的时候删掉某个system，所以这里要判断下
            if (instanceInfo.system) {
                HookUtil.triggerHook(HookType.onSystemPreInit, instanceInfo.system, instanceInfo.subscribeHelper);
                instanceInfo.system.postInit();
                HookUtil.triggerHook(HookType.onSystemPostInit, instanceInfo.system, instanceInfo.subscribeHelper);
            }
        }

        return true;
    }

    public destroySystemByTag(nestedTag: NestedTag) {
        let tag = parseNestedTag(nestedTag);
        if (Array.isArray(tag)) {
            let count = tag.length;
            for (let i = count - 1; i >= 0; i--) {
                this.destroySystemByTag(tag[i]);
            }
            return;
        }

        let data = Env.getCurrentData(Data).systemData;
        let info = data.tagHelper.findInfoByTag(tag);
        if (!info) {
            return;
        }

        if (info.instances.length === 0) {
            // console.log(`system group ${tag} has been uninited.`);
            return;
        }

        console.log("destroy system by tag: " + tag);

        let instances = info.instances;
        let count = instances.length;
        for (let i = count - 1; i >= 0; --i) {
            let info = instances[i] as SystemInstanceInfo;
            if (info.system) {
                info.system.preUninit();
            }
        }

        for (let i = count - 1; i >= 0; --i) {
            let info = instances[i] as SystemInstanceInfo;
            if (info.system) {
                this.onDestroySystem(data, info);
            }
        }

        info.reset();
    }

    public destroyAllSystems() {
        let data = Env.getCurrentData(Data).systemData;
        let all = data.tagHelper.getAllInstances() as SystemInstanceInfo[];

        // order大说明新，新的先删
        all.sort((a, b) => {
            return a.order > b.order ? -1 : 1;
        });

        for (let s of all) {
            if (s.system) {
                s.system.preUninit();
            }
        }

        for (let s of all) {
            if (s.system) {
                this.onDestroySystem(data, s);
            }
        }
    }

    // public findFriendSystem(ctor: SystemConstructor, friendCtor: SystemConstructor): ISystem | undefined {
    //     let data = Env.getCurrentData(Data).systemData;
    //     let tag = data.friends.get(friendCtor);
    //     if (!tag) return;

    //     if (data.tagHelper.getTag(ctor) !== tag) return;
    //     let friendTag = data.tagHelper.getTag(friendCtor);
    //     if (!friendTag) return;

    //     let instances = data.tagHelper.findInstancesByTag(friendTag);
    //     if (!instances) return;

    //     for (let instance of instances) {
    //         if (instance.system.constructor === friendCtor) {
    //             return instance.system;
    //         }
    //     }
    //     return;
    // }

    public isStoreOwnedBySystem(storeCtor: StoreConstructor, systemCtor: SystemConstructor): boolean {
        let data = Env.getCurrentData(Data).storeData;
        let storeCtors = data.systemOwnerToStores.get(systemCtor);
        return storeCtors?.has(storeCtor) === true;
    }

    public getSystemSubscribeHelper(system: ISystem): ISubscribeHelper {
        let ret = Env.getCurrentData(Data).systemData.systems.get(system.constructor as SystemConstructor)?.subscribeHelper;
        assert(ret, "getSystemSubscribeHelper failed, system is invalid");
        return ret;
    }

    public findSystemSubscribeHelper(system: ISystem): ISubscribeHelper | undefined {
        return Env.getCurrentData(Data).systemData.systems.get(system.constructor as SystemConstructor)?.subscribeHelper;
    }

    public findSystem(ctor: SystemConstructor): ISystem | undefined {
        let data = Env.getCurrentData(Data).systemData;
        return data.systems.get(ctor)?.system;
    }

    public findSystemsByTag(tag: string): ISystem[] {
        let data = Env.getCurrentData(Data).systemData;
        let instances = data.tagHelper.findInstancesByTag(tag);
        if (!instances) return [];

        let ret = new Array<ISystem>();
        for (let instance of instances) {
            ret.push(instance.system);
        }
        return ret;
    }

    public unregisterSystem(tagOrCtor: string | SystemConstructor) {
        let systemData = Env.getCurrentData(Data).systemData;
        let systemCtors = systemData.tagHelper.unregister(tagOrCtor);

        let storeData = Env.getCurrentData(Data).storeData;
        for (let ctor of systemCtors) {
            let storeCtors = storeData.systemOwnerToStores.get(ctor);
            if (storeCtors) {
                for (let storeCtor of storeCtors) {
                    storeData.storeToSystemOwners.delete(storeCtor);
                }
                storeData.systemOwnerToStores.delete(ctor);
            }
        }

        return systemCtors;
    }

    public unregisterStore(tagOrCtor: string | StoreConstructor) {
        let data = Env.getCurrentData(Data).storeData;
        data.tagHelper.unregister(tagOrCtor);
    }

    // /////////////////////////////////////////////////////////////////////////////////////////
    private onCreateSystem(data: SystemData, info: SystemInstanceInfo) {
        assert(info.system);

        let ctor = info.system.constructor as SystemConstructor;
        assert(!data.systems.has(ctor), `duplicated system created, system: ${ctor.name}`);
        data.systems.set(ctor, info);

        // 处理hook
        HookUtil.triggerHook(HookType.onSystemPostCreate, info.system, info.subscribeHelper);

        // 处理单例store
        this.createSingletonStores(info.system.constructor as SystemConstructor);
    }

    private onDestroySystem(data: SystemData, info: SystemInstanceInfo) {
        assert(info.system);

        // 处理hook
        HookUtil.triggerHook(HookType.onSystemPreDestroy, info.system, info.subscribeHelper);

        // uninit
        info.system.uninit();

        // 处理订阅
        info.subscribeHelper.unsubscribeAll();

        // 处理单例store
        this.destroySingletonStores(info.system!.constructor as SystemConstructor);

        data.systems.delete(info.system.constructor as SystemConstructor);

        HookUtil.triggerHook(HookType.onSystemPostDestroy, info.system, info.subscribeHelper);

        info.system = undefined;
    }
}

setManager(new Manager());
