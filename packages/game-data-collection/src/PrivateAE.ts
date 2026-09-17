import { F } from "k-ts-framework";

export class _LoadAllTemplateEvent extends F.Event {
    public constructor(public tag?: string) {
        super();
    }
}

export class _UnloadAllTemplateEvent extends F.Event {
    public constructor(public tag?: string) {
        super();
    }
}