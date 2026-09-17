import { createDecipheriv, createHash } from "node:crypto";
import { EOL } from "node:os";
import { inflateRawSync } from "node:zlib";
import { CLI_NAME } from "../constants";
import { normalizeEnvironment, normalizePlatform } from "../utils/environment";

export function decryptLog(inputBuffer: Buffer, appVersion: number, environment: string, platform: string): string {
    if (Number.isNaN(appVersion)) {
        throw new Error("app_res_version tag is not an integer.");
    }

    const environmentSeed = normalizeEnvironment(environment);
    const platformSeed = normalizePlatform(platform);
    const key = generateKey(`${appVersion}_${environmentSeed}`);
    const iv = generateIv(`${appVersion}_${platformSeed}`);
    const contentParts: string[] = [];

    console.log(`[${CLI_NAME}] appVersion: ${appVersion}, environment: ${environmentSeed}, platform: ${platformSeed}`);
    let offset = 0;
    while (offset < inputBuffer.length) {
        if (offset + 4 > inputBuffer.length) {
            throw new Error(`Unexpected end of file while reading block length at offset ${offset}.`);
        }

        const blockLength = inputBuffer.readInt32LE(offset);
        offset += 4;

        if (blockLength < 0) {
            throw new Error(`Encountered negative block length ${blockLength} at offset ${offset - 4}.`);
        }

        if (offset + blockLength > inputBuffer.length) {
            throw new Error(`Block length ${blockLength} exceeds remaining bytes ${inputBuffer.length - offset} at offset ${offset}.`);
        }

        const encryptedBlock = inputBuffer.subarray(offset, offset + blockLength);
        offset += blockLength;

        const textBlock = decryptAndDecompress(encryptedBlock, key, iv);
        for (const line of textBlock.split("\n")) {
            contentParts.push(line, EOL);
        }
    }

    return contentParts.join("");
}

function decryptAndDecompress(cipherText: Buffer, key: Buffer, iv: Buffer): string {
    const decipher = createDecipheriv("aes-256-cbc", key, iv);
    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return inflateRawSync(decrypted).toString("utf8");
}

function generateKey(seed: string): Buffer {
    return createHash("sha256").update(seed, "utf8").digest();
}

function generateIv(seed: string): Buffer {
    return generateKey(seed).subarray(0, 16);
}
