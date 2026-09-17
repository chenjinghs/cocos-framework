import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export function requireRepoRoot(): string {
    const repoRoot = findRepoRoot(process.cwd()) ?? findRepoRoot(__dirname);
    if (!repoRoot) {
        throw new Error("Cannot find repository root containing .agents directory.");
    }

    return repoRoot;
}

function findRepoRoot(startPath: string): string | undefined {
    let current = resolve(startPath);
    while (true) {
        if (existsSync(join(current, ".agents"))) {
            return current;
        }

        const parent = dirname(current);
        if (parent === current) {
            return undefined;
        }

        current = parent;
    }
}
