import { Constructor } from "../data/Define";
import { SerializeContext } from "../field/Base";
import { assertWithLoc } from "../misc/Localization";
import { Registry } from "../misc/Registry";

export interface IValidatorConfig {
    type: string;
    [key: string]: unknown;
}

export abstract class Validator {
    public static register<T extends Validator>(this: Constructor<T>) {
        Registry.get(Validator).register(this);
    }
    public static create(config: IValidatorConfig) {
        let validator = Registry.get(Validator).create<Validator>(config.type);
        assertWithLoc(validator, "create-validator-failed", { type: config.type });
        validator.config = config;
        return validator;
    }

    public abstract validate(value: unknown, context: SerializeContext): void;

    public config!: IValidatorConfig;
    public getConfig<T>() {
        return this.config as T;
    }
}
