export let runInMultiThread: (funcInMultiThread: () => any) => any;

export function pushElementOrArray<T>(target: Array<T>, element: T | Array<T>) {
    if (Array.isArray(element)) target.push(...element.filter((v) => v !== undefined));
    else if (element) target.push(element);
}
