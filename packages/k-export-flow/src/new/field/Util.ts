import { Constructor } from "../data/Define";
import { deepCopy } from "../misc/Util";
import { Validator } from "../validator/Base";
import { EValidatorNumberType, NumberValidator } from "../validator/Validator";
import { Field } from "./Base";

export function verifyValidator(field: Field, validatorType: Constructor, verifyConfig?: (config: any) => void) {
    if (!field.hasValidator(validatorType) && (validatorType as any).testConfig(field.config)) {
        let c = deepCopy(field.config);
        c.type = validatorType.name;
        if (verifyConfig) verifyConfig(c);
        field.validators.push(Validator.create(c));
    }
}

export function verifyNumberValidator(field: Field, numberType: EValidatorNumberType) {
    verifyValidator(field, NumberValidator, (c) => {
        c.numberType = c.numberType ?? numberType;
    });
}
