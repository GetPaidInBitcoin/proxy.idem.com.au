import { ConfigService } from "@nestjs/config";
import { Injectable, Logger } from "@nestjs/common";
import { IEmailService, IOauthService } from "./../interfaces";
import * as openpgp from "openpgp";
import { AuthToken, ConfigSettings, RawEmailParams } from "../types/general";
import { getCache, setCache } from "../clients/cache";
import axios, { AxiosInstance } from "axios";

@Injectable()
export class OutlookService implements IEmailService, IOauthService {
    private readonly httpClient: AxiosInstance;
    private readonly logger = new Logger("OutlookService");

    constructor(private config: ConfigService) {}

    public async refreshTokens(): Promise<void> {
        const token = await getCache<AuthToken>("outlook-token");

        // call Outlook API to refresh tokens
        const data = {
            refresh_token: token.refresh_token,
            client_id: process.env.OUTLOOK_CLIENT_ID,
            scope: "Mail.ReadWrite offline_access Mail.Send",
            redirect_uri: "https://proxy.idem.com.au/oauth2/callback",
            client_secret: process.env.OUTLOOK_CLIENT_SECRET,
            grant_type: "refresh_token"
        };

        const config = {
            method: "post",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            },
            data: data,
            url: "https://login.microsoftonline.com/common/oauth2/v2.0/token"
        };

        const result = await axios(config);

        if (result.status != 200) {
            throw new Error("Failed to refresh Outlook tokens");
        }

        const newToken = result.data as AuthToken;
        console.log(newToken);

        //await setCache<AuthToken>("outlook-token", newToken, 2 * 60 * 60);
    }

    public sendEmailVerification = async (
        email: string,
        verificationCode: string,
        recipientPublicKey: string
    ): Promise<void> => {
        const subject = `IDEM email verification`;
        this.logger.log(`${email} Verification code email sent`);
        const opt = {
            to: email,
            toName: email,
            subject,
            text: `Your confirmation code is ${verificationCode}.
             Enter the code in the IDEM mobile app to verify your email.`
        };

        if (recipientPublicKey) {
            throw new Error("Method not implemented.");
        }

        return this.sendRawEmail(opt);
    };

    private sendRawEmail = async (params: RawEmailParams) => {
        try {
            const unsignedMessage = await openpgp.createCleartextMessage({
                text: params.text
            });

            const privateKeyArmored = this.config.get(
                ConfigSettings.PGP_PRIVATE_KEY
            );

            if (!privateKeyArmored) throw new Error("Idem PGP key not found");

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

            const cleartextMessage = await openpgp.sign({
                message: unsignedMessage,
                signingKeys: privateKey
            });

            throw new Error("Method not implemented.");
        } catch (error) {
            this.logger.error(error);
            throw new Error(error);
        }
    };
}
