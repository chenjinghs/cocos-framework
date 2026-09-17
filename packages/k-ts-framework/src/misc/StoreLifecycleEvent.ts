import { Store } from "../framework";
import { StoreEvent } from "../framework/Event";
import { RuntimeContext } from "./RuntimeContext";

export class StoreCreateSEvent extends StoreEvent {}

export class StoreDestroySEvent extends StoreEvent {}

export class StoreChangeSEvent extends StoreEvent {}

RuntimeContext.dispatchStoreCreateSEvent = function (store: Store, ...args: any[]) {
    StoreEvent.dispatch.call(StoreCreateSEvent, store, ...args);
};

RuntimeContext.dispatchStoreDestroySEvent = function (store: Store, ...args: any[]) {
    RuntimeContext.get().flushDirtyStore(store);
    StoreEvent.dispatch.call(StoreDestroySEvent, store, ...args);
};

RuntimeContext.dispatchStoreChangeSEvent = function (store: Store, ...args: any[]) {
    StoreEvent.dispatch.call(StoreChangeSEvent, store, ...args);
};
