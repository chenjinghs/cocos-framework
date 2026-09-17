import { F } from "k-ts-framework";

const DELEGATE_HANDLES_KEY = Symbol("DELEGATE_HANDLES_KEY");

interface IUIHandles {
    [key: string | symbol]: symbol;
}

export namespace UIHandle {
    export function gen(store: F.Store, key?: string) {
        let handleRecords: IUIHandles = Reflect.get(store, DELEGATE_HANDLES_KEY) ?? {};
        let handle = Symbol(key);
        handleRecords[key ?? handle] = handle;
        Reflect.set(store, DELEGATE_HANDLES_KEY, handleRecords);
        return handle;
    }

    export function find(store: F.Store, key: string) {
        let handleRecords: IUIHandles | undefined = (<any>store)[DELEGATE_HANDLES_KEY];
        return handleRecords?.[key];
    }

    export function get(store: F.Store, key: string) {
        let handle = find(store, key);
        F.assert(handle, `UI Handle ${key} not found`);
        return handle;
    }

    export function popUIHandles(store: F.Store) {
        let handleRecords: IUIHandles | undefined = Reflect.get(store, DELEGATE_HANDLES_KEY);
        let handles = handleRecords ? Reflect.ownKeys(handleRecords).map((key) => Reflect.get(handleRecords!, key)) : [];
        Reflect.deleteProperty(store, DELEGATE_HANDLES_KEY);
        return handles;
    }
}
