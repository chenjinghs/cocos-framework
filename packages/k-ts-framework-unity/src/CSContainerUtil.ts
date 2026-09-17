// $generic 调用性能不会太好，相关转化放在这个文件里

// --------------------------------------------
// List
export type CSList<T> = CS.System.Collections.Generic.List$1<T>;
const CSStringList = puer.$generic(CS.System.Collections.Generic.List$1, CS.System.String);

export namespace CSListUtil {
    export function foreach<T>(list: CSList<T>, callback: (item: T, index: number) => void) {
        for (let i = 0; i < list.Count; i++) {
            callback(list.get_Item(i), i);
        }
    }

    export function convertToTsArray<T>(list: CSList<T>): T[] {
        let items = [];
        for (let i = 0; i < list.Count; i++) {
            items.push(list.get_Item(i));
        }
        return items;
    }

    export function convertToCSStringList(items: string[]): CSList<string> {
        let list = new CSStringList<string>();
        items.forEach((item) => list.Add(item));
        return list;
    }
}

// --------------------------------------------
// Array
export type CSArray<T> = CS.System.Array$1<T>;
export namespace CSArrayUtil {
    export function foreach<T>(array: CSArray<T>, callback: (item: T, index: number) => void) {
        for (let i = 0; i < array.Length; i++) {
            callback(array.get_Item(i), i);
        }
    }

    export function convertToTsArray<T>(array: CSArray<T>): T[] {
        let items = [];
        for (let i = 0; i < array.Length; i++) {
            items.push(array.get_Item(i));
        }
        return items;
    }
}

// --------------------------------------------
// Dictionary
export type CSDictionary<K, V> = CS.System.Collections.Generic.Dictionary$2<K, V>;
const CSStringStringDictionary = puer.$generic(CS.System.Collections.Generic.Dictionary$2, CS.System.String, CS.System.String);
export namespace CSDictionaryUtil {
    export function foreach<K, V>(dict: CSDictionary<K, V>, callback: (key: K, value: V) => void) {
        let enumerator = dict.GetEnumerator();
        while (enumerator.MoveNext()) {
            callback(enumerator.Current.Key, enumerator.Current.Value);
        }
    }

    export function convertToTsMap<K, V>(dict: CSDictionary<K, V>): Map<K, V> {
        let map = new Map<K, V>();
        let enumerator = dict.GetEnumerator();
        while (enumerator.MoveNext()) {
            map.set(enumerator.Current.Key, enumerator.Current.Value);
        }
        return map;
    }

    export function newCSStringStringDictionary(): CSDictionary<string, string> {
        return new CSStringStringDictionary();
    }

    export function convertToCSStringStringMap(items: Map<string, string>): CSDictionary<string, string> {
        let map = new CSStringStringDictionary();
        items.forEach((value, key) => map.Add(key, value));
        return map;
    }
}