import { Env } from "../framework/Env.js";
import { EDataInheritType, IEnvData, IStore } from "../framework/Interface.js";
import { assert } from "../global/GlobalFunctions.js";

/*
 * 记录运行时的一些信息，包括堆栈检查，action记录什么的
 */
export class RuntimeContext implements IEnvData {
    // 这几个这么写都是为了防止循环引用
    public static dispatchStoreCreateSEvent: (store: IStore) => void;
    public static dispatchStoreDestroySEvent: (store: IStore) => void;
    public static dispatchStoreChangeSEvent: (store: IStore) => void;

    public static get(): RuntimeContext {
        return Env.getCurrentData(RuntimeContext);
    }

    private dirtyStores?: Map<IStore, Env>;
    // private infoStack = new Array<any>();

    public inheritFrom(_source: IEnvData, _dataInheritType: EDataInheritType) {}

    public addDirtyStore(store: IStore) {
        if (this.dirtyStores === undefined) {
            this.dirtyStores = new Map();

            Promise.resolve().then(() => {
                this.dispatchDirtyStores();
            });
        }

        let foundEnv = this.dirtyStores.get(store);
        assert(foundEnv === undefined || foundEnv === Env.current, `same store change in multi env: ${store}`);
        this.dirtyStores.set(store, Env.current);
    }

    public flushDirtyStore(store: IStore) {
        let env = this.dirtyStores?.get(store);
        if (!env) return;

        this.dirtyStores!.delete(store);
        Env.scope(env, () => {
            RuntimeContext.dispatchStoreChangeSEvent(store);
        });
    }

    // public pushInfo(info: any) {
    //     this.infoStack.push(info);
    // }

    // public popInfo() {
    //     this.infoStack.pop();
    //     if (this.infoStack.length === 0) {
    //         this.dispatchDirtyStores();
    //     }
    // }

    public clearInfos() {
        this.dirtyStores = undefined;
        // this.infoStack.splice(0, this.infoStack.length);
    }

    private dispatchDirtyStores() {
        let lastEnv;
        let envHandle;
        while (this.dirtyStores !== undefined) {
            let stores = this.dirtyStores;
            this.dirtyStores = undefined;

            for (let [store, env] of stores) {
                if (lastEnv !== env) {
                    lastEnv = env;
                    if (envHandle !== undefined) Env.scopeEnd(envHandle);
                    envHandle = Env.scopeBegin(env);
                }

                // HookManager.get().triggerHook(HookType.onStorePostUpdate, v);
                if (store.valid) {
                    RuntimeContext.dispatchStoreChangeSEvent(store);
                }
            }

            if (envHandle !== undefined) {
                Env.scopeEnd(envHandle);
                envHandle = undefined;
            }
        }
    }
}
