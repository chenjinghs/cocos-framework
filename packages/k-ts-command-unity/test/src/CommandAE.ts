import { command } from "k-ts-command";
import { F } from "k-ts-framework";

@command("fb.foobar", "test command1")
export class FoobarAction extends F.Action {
    public constructor(public foo: number, public bar: string, public baz: boolean) {
        super();
    }
}

@command("fb.foobar2", "test command2")
export class Foobar2Action extends F.Action {
    public constructor() {
        super();
    }
}

@command("gms fb.foobar3", "test command3")
export class Foobar3Action extends F.Action {
    public constructor(public foo: number, public bar: string, public baz: boolean) {
        super();
    }
}

@command("gms fb.foobar4", "test command4")
export class Foobar4Action extends F.Action {
    public constructor() {
        super();
    }
}
