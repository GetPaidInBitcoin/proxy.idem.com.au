import { ConfigService } from "@nestjs/config";
import { getPrivateKey } from "../utils/pgp";
import { ConfigSettings } from "../types/general";
import * as openpgp from "openpgp";

// Test script to diagnose PGP key issues
export async function testPGPKey() {
    try {
        // Create a mock config service
        const mockConfig = {
            get: (key: string) => {
                switch (key) {
                    case ConfigSettings.PGP_PRIVATE_KEY:
                        return "idem-test-pgp.asc"; // Update with your actual key file path
                    case ConfigSettings.PGP_PASSPHRASE:
                        return "Test1234"; // Update with your actual passphrase
                    default:
                        return null;
                }
            }
        } as ConfigService;

        console.log("Starting PGP key test...");

        // Test loading private key
        const privateKey = await getPrivateKey(mockConfig);

        console.log("✅ Private key loaded successfully!");
        console.log(`Key ID: ${privateKey.getKeyID().toHex()}`);
        console.log(`Algorithm: ${privateKey.getAlgorithmInfo().algorithm}`);
        console.log(`Is decrypted: ${privateKey.isDecrypted()}`);

        // Test creating a simple signature
        const message = await openpgp.createMessage({ text: "Test message" });

        const signature = await openpgp.sign({
            message: message,
            signingKeys: privateKey,
            format: "armored"
        });

        console.log("✅ Signature created successfully!");
        console.log(
            "Signature preview:",
            signature.toString().substring(0, 100) + "..."
        );

        // Test verification
        const verificationResult = await openpgp.verify({
            message: await openpgp.readMessage({ armoredMessage: signature }),
            verificationKeys: privateKey.toPublic()
        });

        console.log("✅ Signature verified successfully!");
        console.log(
            "Verification valid:",
            await verificationResult.signatures[0].verified
        );
    } catch (error) {
        console.error("❌ PGP Test Failed:");
        console.error("Error:", error.message);
        console.error("Stack:", error.stack);

        // Additional diagnostics
        console.log("\n🔍 Diagnostic Information:");
        console.log("1. Check if the PGP private key file exists");
        console.log("2. Verify the passphrase is correct");
        console.log("3. Ensure the key file is not corrupted");
        console.log(
            "4. Check if the key was generated with the correct parameters"
        );
    }
}

// Run the test if this file is executed directly
if (require.main === module) {
    testPGPKey();
}