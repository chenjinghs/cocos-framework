import { assert } from "../global/GlobalFunctions";

type Constructor<T = {}> = new (...args: any[]) => T;

// ///////////////////////////////////////////////////////////////////////////
export class StoreKeyHelper {
    private static maxId = 0;
    private static ctorToIds = new Map<any, Map<any, number>>();

    public static getKey(storeCtor: Constructor, type: any, createIfNotExists: boolean): number | undefined {
        assert(storeCtor);
        let ids = this.ctorToIds.get(storeCtor);
        let ret = ids?.get(type);

        if (ret || !createIfNotExists) {
            return ret;
        }

        if (!ids) {
            ids = new Map<any, number>();
            this.ctorToIds.set(storeCtor, ids);
        }

        let newId = this.generateId();
        ids.set(type, newId);
        return newId;
    }

    private static generateId(): number {
        return ++this.maxId;
    }
}
