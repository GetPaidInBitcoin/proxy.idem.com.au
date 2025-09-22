import { ConfigService } from "@nestjs/config";
import * as openpgp from "openpgp";
import { ConfigSettings } from "../types/general";
import * as fs from "fs";

export const getPrivateKey = async (
    config: ConfigService
): Promise<openpgp.PrivateKey> => {
    try {
        const keyPath = config.get(ConfigSettings.PGP_PRIVATE_KEY);
        console.log(`Loading PGP private key from: ${keyPath}`);

        const privateKeyArmored = fs.readFileSync(keyPath, "utf8");

        if (!privateKeyArmored) throw new Error("Idem PGP key not found");

        console.log(`Private key loaded, length: ${privateKeyArmored.length}`);
        console.log(
            `Private key starts with: ${privateKeyArmored.substring(0, 50)}...`
        );

        const privateKeys = await openpgp.readPrivateKeys({
            armoredKeys: privateKeyArmored
        });

        console.log(`Found ${privateKeys.length} private keys`);

        if (privateKeys.length === 0) {
            throw new Error("No private keys found in the armored key data");
        }

        const passphrase = config.get(ConfigSettings.PGP_PASSPHRASE) as string;
        console.log(`Using passphrase: ${passphrase ? "[SET]" : "[NOT SET]"}`);

        const privateKey = await openpgp.decryptKey({
            privateKey: privateKeys[0],
            passphrase
        });

        console.log(
            `Private key decrypted successfully, isDecrypted: ${privateKey.isDecrypted()}`
        );
        return privateKey;
    } catch (error) {
        console.error("Error in getPrivateKey:", error);
        throw new Error(`PGP Key Error: ${error.message || error}`);
    }
};
