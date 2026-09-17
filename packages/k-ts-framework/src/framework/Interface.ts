/* eslint-disable @typescript-eslint/method-signature-style */
/**
 * 环境类型，没弄成enum是为了外部可以扩展
 */
export class EEnvType {
    public static Default = 0;
    public static Common = 1;
    public static Client = 1 << 1;
    public static StandaloneServer = 1 << 2;
    public static BattleServer = 1 << 3;
    public static ServerLogic = this.StandaloneServer | this.BattleServer;
    public static All = 0xffffffff;
}

/**
 * 环境创建时需要按什么方式继承数据
 */
export enum EDataInheritType {
    None = 0,
    StaticData = 1 << 1,
    DynamicData = 1 << 2,
    All = StaticData | DynamicData,
}

// /**
//  * 异步请求操作类型
//  */
// export enum EAsyncGroupOperator {
//     All = 0,
//     Any,
// }

/**
 * 多Promise请求操作类型
 */
export enum EMultiPromiseOperator {
    All = 0,
    Any,
    AllSettled,
    Race,
}

export type ResolveFuncType = (value: unknown) => void;

/**
 * 环境数据
 */
export interface IEnvData {
    /**
     * 继承数据时需要实现此方法
     * @param source 源数据
     * @param dataInheritType 数据继承方式
     */
    inheritFrom(source: IEnvData, dataInheritType?: EDataInheritType): void;
}

export type EnvDataConstructor<T = {}> = new () => T & IEnvData;

/**
 * 环境
 */
export interface IEnv {
    get name(): string;
    get type(): EEnvType;
    get valid(): boolean;

    /**
     * 获取当前环境里的自定义数据（不存在则创建个新的）
     * @param type
     * @returns 自定义数据
     */
    getData<T>(type: EnvDataConstructor<T>): T;
}

/**
 * Store 只存数据
 */
export interface IStore {
    parent: RIStore | null;
    children?: Array<RIStore>;
    id: number;
    get tag(): string | undefined;
    get valid(): boolean;
}

/**
 * System 无数据，都是处理函数
 */
export interface ISystem {
    init(): void | boolean;
    postInit(): void;
    preUninit(): void;
    uninit(): void;
}

/**
 * 帮助持有 System 的wrapper
 */
export interface ISystemWrapper {
    system: ISystem | undefined;
}

export interface IStartAsyncParams {
    callback: (asyncHandle: symbol) => Promise<unknown>;
    thisArg?: ISystem;
    canRunMultiPromiseAtOneTime?: boolean;
    description?: string | { stack?: string };
    resolveCallback?: (() => void) | ((value: any) => void);
    rejectCallback?: (reason?: any) => void;
    finallyCallback?: (asyncHandle: symbol, result?: any, rejectReason?: any) => void;
    throwRejectError?: boolean;
    parentAsyncHandle?: symbol;
}

export interface IStartAsyncExtraOutput {
    rootPromise: Promise<unknown>;
}

/**
 * System中用的订阅器帮助类接口，用来管理订阅函数
 */
export interface ISubscribeHelper {
    subscribe(...args: any[]): number;
    subscribeWithHandle(handle: symbol, ...args: any[]): symbol;
    unsubscribe(...args: any[]): boolean;
    unsubscribeWithHandle(handle: symbol | number): boolean;
    unsubscribeAll(includeAsync: boolean): void;
    hasSubscribed(handle: symbol | number): boolean;

    // //////////////////////////////////////////////////////////////////
    // 异步相关
    startAsync(params: IStartAsyncParams, output?: IStartAsyncExtraOutput): symbol | undefined;
    // startAsyncGroup(
    //     operator: EAsyncGroupOperator,
    //     handles: symbol | symbol[],
    //     finishCallback?: () => void,
    //     thisArg?: ISystem,
    //     description?: string,
    // ): symbol;
    cancelAsync(asyncHandle: symbol): void;
    rejectAsync(asyncHandle: symbol, reason?: unknown): Promise<never>;
    newPromise(asyncHandle: symbol, ...args: any[]): Promise<unknown>;
    // multiPromise(asyncHandle: symbol, promises: Array<Promise<unknown>>, operator: EMultiPromiseOperator): Promise<unknown>;
    hasAnyAsync(): boolean;
    cancelAllAsync(): void;
}

// /////////////////////////////////////////////////////////////////////////////////////////
export type RIStore = Readonly<IStore>;
export type Constructor<T = {}> = new (...args: any[]) => T;
export type StoreConstructor = new (parent: IStore | null) => IStore;
export type SystemConstructor = new () => ISystem;
export type CallbackType = (...args: any[]) => any;
type NestedTagArray = (string | NestedTagArray)[];
export type NestedTag = string | NestedTagArray;

/**
 * System和Store的管理类，负责处理他们的创建销毁等流程，以及Env初始化等
 */
export interface IManager {
    onEnvInit(env: IEnv, dispatchEvent: boolean): void;
    onEnvUninit(env: IEnv): void;

    // //////////////////////////////////////////////////////////////////////////////////////////////
    registerStore<T extends StoreConstructor>(storeCtor: T, tag?: string): void;
    unregisterStore(tagOrCtor: string | StoreConstructor): void;
    createStore<T extends StoreConstructor>(storeCtor: T, parent: IStore | RIStore): IStore;
    createStoreByTag(tag: NestedTag, parent: IStore | RIStore): RIStore | RIStore[];

    destroyStore(store: IStore): void;
    destroyStoreById(id: number): void;
    destroyStoreByTag(tag: NestedTag): void;

    findStoreById(id: number): IStore | undefined;
    findStoreByTag(tag: string): IStore[];
    findStoreTag(storeCtor: StoreConstructor): string | undefined;
    findStoresByCtor(storeCtor: StoreConstructor): IStore[];
    isValidStoreTag(tag: string): boolean;
    getRootStore(): IStore;
    findSingletonStore(storeCtor: StoreConstructor): IStore | undefined;
    setSharedSingletonStore(storeCtor: StoreConstructor): void;
    getStoreOwnerCtor(store: StoreConstructor): SystemConstructor | undefined;
    setDefaultSingletonParentStore(store: IStore): void;
    getDefaultSingletonParentStore(): IStore;

    // //////////////////////////////////////////////////////////////////////////////////////////////
    registerSystem(systemCtor: SystemConstructor, tag: string, stores?: StoreConstructor | StoreConstructor[], envType?: number): void;
    unregisterSystem(tagOrCtor: string | SystemConstructor): SystemConstructor[];
    // registerSystemFriend(systemCtor: SystemConstructor, tag: string): void;
    createSystemByTag(tag: NestedTag): boolean;

    destroySystemByTag(tag: NestedTag): void;
    destroyAllSystems(): void;

    // findFriendSystem(ctor: SystemConstructor, friendCtor: SystemConstructor): ISystem | undefined;
    isStoreOwnedBySystem(storeCtor: StoreConstructor, systemCtor: SystemConstructor): boolean;
    getSystemSubscribeHelper(system: ISystem): ISubscribeHelper;
    findSystemSubscribeHelper(system: ISystem): ISubscribeHelper | undefined;
    findSystem(ctor: SystemConstructor): ISystem | undefined;
    findSystemsByTag(tag: string): ISystem[];
    // reloadSystem(path: string): void;    // TODO: v8自带reload，如果自带的好使这个就不用实现了
}

// /////////////////////////////////////////////////////////////////////////////////////////
let implement: any;

export function setManager(imp: IManager) {
    implement = imp;
}

export function getManager(): IManager {
    return implement;
}
