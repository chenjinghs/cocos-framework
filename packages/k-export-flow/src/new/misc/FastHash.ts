export function fastHash(data: Buffer | string): string {
    const str = typeof data === 'string' ? data : data.toString('binary');
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return (h >>> 0).toString(36);
}
