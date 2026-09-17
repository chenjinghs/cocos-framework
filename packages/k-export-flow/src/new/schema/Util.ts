import { DataWithSchema, Schema } from "../data/Data";
import { TaggedInfoExtraData } from "../data/Other";
import { FieldDeclaration } from "../field/Base";
import { StructFieldDeclaration } from "../field/Field";
import { assert } from "../misc/Util";
import { ESchemaDataType } from "./Base";

export function findDataWithSchema(outputs: Array<DataWithSchema>, schemaType: ESchemaDataType, name: string) {
    return outputs.find((output) => {
        return output.schema.config.type === schemaType && output.schema.config.name === name;
    });
}

export function addDataWithSchema(outputs: Array<DataWithSchema>, schemaType: ESchemaDataType, name: string, data: object) {
    let schema = Schema.create(schemaType);
    assert(schema, `invalid schema type ${schemaType}`);
    schema.config = {
        name: name,
        type: schemaType,
        fields: [],
    };
    schema.schemaFiles = [`${name}.yml`];
    void schema.generateFields();

    let output = new DataWithSchema(data, schema);
    outputs.push(output);
    setCustomDeclaration(output, true);
    return output;
}

export function removeDataWithSchema<T extends Schema>(outputs: Array<DataWithSchema>, schemaType: ESchemaDataType, name: string) {
    let index = outputs.findIndex((output) => {
        return output.schema.config.type === schemaType && output.schema.config.name === name;
    });
    if (index >= 0) {
        outputs.splice(index, 1);
        return true;
    } else {
        return false;
    }
}

export function markDataWithSchemaToBeDeleted(output: DataWithSchema) {
    output.toBeDeleted = true;
}

export function getDataTemplates<T = any>(output: DataWithSchema) {
    return output.data as T;
}

export function setFieldDeclaration(output: DataWithSchema, alias: string, value: string, optional: boolean) {
    output.schema.declarationSet.fields.set(alias, new FieldDeclaration(value, optional));
}

export function getFieldDeclaration(output: DataWithSchema, alias: string) {
    return output.schema.declarationSet.fields.get(alias);
}

export function deleteFieldDeclaration(output: DataWithSchema, alias: string) {
    return output.schema.declarationSet.fields.delete(alias);
}

export function setAllFieldDeclarations(output: DataWithSchema, fields: Map<string, string>, optional?: Set<string>) {
    let declarationSet = output.schema.declarationSet;
    declarationSet.fields.clear();
    for (let [alias, value] of fields) {
        declarationSet.fields.set(alias, new FieldDeclaration(value, optional?.has(alias)));
    }
}

export function setInterfaceFieldDeclaration(output: DataWithSchema, interfaceAlias: string, fieldAlias: string, value: string, optional?: boolean) {
    let ifDecl = output.schema.declarationSet.interfaces.get(interfaceAlias);
    if (!ifDecl) return false;

    ifDecl.fields.set(fieldAlias, new FieldDeclaration(value, optional));
    return true;
}

export function deleteInterfaceFieldDeclaration(output: DataWithSchema, interfaceAlias: string, fieldAlias: string) {
    let ifDecl = output.schema.declarationSet.interfaces.get(interfaceAlias);
    if (!ifDecl) return false;

    return ifDecl.fields.delete(fieldAlias);
}

export function deleteInterfaceDeclaration(output: DataWithSchema, interfaceAlias: string) {
    return output.schema.declarationSet.interfaces.delete(interfaceAlias);
}

export function setInterfaceDeclaration(output: DataWithSchema, interfaceAlias: string, fields: Map<string, string>, optional?: Set<string>) {
    let interfaces = output.schema.declarationSet.interfaces;
    interfaces.delete(interfaceAlias);

    let newDecl = new StructFieldDeclaration();
    for (let [alias, value] of fields) {
        newDecl.fields.set(alias, new FieldDeclaration(value, optional?.has(alias)));
    }
    interfaces.set(interfaceAlias, newDecl);
}

export function setCustomDeclaration(output: DataWithSchema, clearExistedInterfaces: boolean) {
    let declarationSet = output.schema.declarationSet;
    declarationSet.custom = true;

    if (clearExistedInterfaces) {
        declarationSet.fields.clear();
        declarationSet.interfaces.clear();
    }
}

export function clearAllDeclaration(output: DataWithSchema) {
    let declarationSet = output.schema.declarationSet;
    declarationSet.fields.clear();
    declarationSet.interfaces.clear();
}

export function addExtraData(output: DataWithSchema, extraData: string[] | string) {
    output.extraData.push(new TaggedInfoExtraData(Array.isArray(extraData) ? extraData : [extraData]));
}

export function removeExtraData(output: DataWithSchema) {
    for (let i = 0; i < output.extraData.length; ++i) {
        if (output.extraData[i] instanceof TaggedInfoExtraData) {
            output.extraData.splice(i, 1);
            break;
        }
    }
}
