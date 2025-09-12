import { ConfigService } from "@nestjs/config";
import { Injectable, Logger } from "@nestjs/common";
import mailJet, { Client } from "node-mailjet";
import { IEmailService } from "../interfaces";
import * as openpgp from "openpgp";
import {
    ConfigSettings,
    RawEmailParams,
    SimpleEmailParams
} from "../types/general";

import * as fs from "fs";
import axios from "axios";
import { getPrivateKey } from "src/utils/pgp";

@Injectable()
export class MailJetService implements IEmailService {
    private readonly emailClient: Client;
    private readonly logger = new Logger("MailJetService");

    constructor(private config: ConfigService) {
        // this.emailClient = mailJet.apiConnect(
        //     this.config.get(ConfigSettings.MAILJET_API_KEY),
        //     this.config.get(ConfigSettings.MAILJET_SECRET)
        // );
    }

    public sendEmailVerification = async (
        email: string,
        verificationCode: string,
        recipientPublicKey: string
    ): Promise<void> => {
        const subject = `IDEM email verification`;
        const opt = {
            to: email,
            toName: email,
            subject,
            text: `Your confirmation code is ${verificationCode}.  Enter the code in the IDEM mobile app to verify your email.`
        };

        this.logger.log(`Sending code ${verificationCode} to ${email}`);

        if (
            (email.toLowerCase().endsWith("protonmail.com") ||
                email.toLowerCase().endsWith("protonmail.ch")) &&
            !recipientPublicKey
        ) {
            const response = await axios.get(
                `https://api.protonmail.ch/pks/lookup?op=get&search=${email}`
            );
            recipientPublicKey = response.data;
        }

        try {
            if (recipientPublicKey && recipientPublicKey !== "") {
                await this.sendEncryptedRawEmail(opt, recipientPublicKey);
                this.logger.log(
                    `Encrypted verification code ${verificationCode} email sent to ${email}`
                );
            } else {
                await this.sendSignedRawEmail(opt);
                this.logger.log(
                    `Signed verification code email sent to ${email}`
                );
            }
        } catch (error) {
            this.logger.error(error.message);
            throw new Error(error);
        }
    };

    private getMailJetBasePayload = (params: SimpleEmailParams) => {
        return {
            From: {
                Email: this.config.get(ConfigSettings.FROM_EMAIL_ADDRESS),
                Name: "IDEM"
            },
            To: [
                {
                    Email: params.to,
                    Name: params.toName
                }
            ],
            Subject: params.subject,
            TextPart: "",
            CustomID: ""
        };
    };

    private sendSignedRawEmail = async (params: RawEmailParams) => {
        try {
            const unsignedMessage = await openpgp.createCleartextMessage({
                text: params.text
            });

            const privateKey = await getPrivateKey(this.config);

            const cleartextMessage = await openpgp.sign({
                message: unsignedMessage,
                signingKeys: privateKey
            });

            this.logger.log(cleartextMessage);

            this.emailClient.post("send", { version: "v3.1" }).request({
                messages: [
                    {
                        ...this.getMailJetBasePayload(params),
                        TextPart: cleartextMessage
                    }
                ]
            });
        } catch (error) {
            // this.logger.error(error.message);
            throw new Error(error);
        }
    };

    private sendEncryptedRawEmail = async (
        params: RawEmailParams,
        recipientPublicKey: string
    ) => {
        try {
            const privateKeyArmored = fs.readFileSync(
                this.config.get(ConfigSettings.PGP_PRIVATE_KEY),
                "utf8"
            );

            if (!privateKeyArmored)
                throw new Error("sendRawEmail: Idem PGP key not found");

            const privateKeys = await openpgp.readPrivateKeys({
                armoredKeys: privateKeyArmored
            });

            const passphrase = this.config.get(
                ConfigSettings.PGP_PASSPHRASE
            ) as string;

            const privateKey = await openpgp.decryptKey({
                privateKey: privateKeys[0],
                passphrase
            });

            if (recipientPublicKey.startsWith("https://")) {
                const result = await axios.get(recipientPublicKey);
                recipientPublicKey = result.data;
                console.log(recipientPublicKey);
            }

            const publicKey = await openpgp.readKey({
                armoredKey: recipientPublicKey
            });

            const encrypted = await openpgp.encrypt({
                message: await openpgp.createMessage({ text: params.text }), // input as Message object
                encryptionKeys: publicKey,
                signingKeys: privateKey
            });

            this.emailClient.post("send", { version: "v3.1" }).request({
                messages: [
                    {
                        ...this.getMailJetBasePayload(params),
                        TextPart: encrypted
                    }
                ]
            });
        } catch (error) {
            this.logger.error(error);
            throw new Error(error);
        }
    };
}
