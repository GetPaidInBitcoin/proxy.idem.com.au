import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { IKYCService, VerifyUserRequest } from "../interfaces";
import soap from "soap";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const soapImport = require("soap");
import * as openpgp from "openpgp";
import { getPrivateKey } from "../utils/pgp";
import { ClaimResponsePayload, ClaimType } from "../types/verification";
import { ConfigSettings, KycResponse, KycResult } from "../types/general";
import { ethers } from "ethers";
import { EthrDID } from "ethr-did";
import { signMessage } from "../utils/wallet";
import {
    BirthCertificateData,
    GetSourcesResult,
    GetVerificationResult,
    LicenceData,
    MedicareData,
    PassportData,
    PGPVerifiableCredential,
    RegisterVerificationData,
    RegisterVerificationResult,
    SetFieldResult,
    SetFieldsPayload,
    Source,
    UnverifiableCredential,
    VerifyDTO,
    VerifyReturnData
} from "../types/greenId";

@Injectable()
export class GreenIdService implements IKYCService {
    private greenId: soap.Client;
    private readonly logger = new Logger("GreenIdService");
    private readonly greenIdAccountId: string;
    private readonly greenIdPassword: string;
    private readonly isTest: boolean;

    constructor(private config: ConfigService) {
        console.log(
            `Initialising GreenIdService ${this.config.get(
                ConfigSettings.GREENID_URL
            )}`
        );
        this.initialiseGreenIdClient(config.get(ConfigSettings.GREENID_URL));
        this.greenIdAccountId = this.config.get(
            ConfigSettings.GREENID_ACCOUNT_ID
        );
        this.greenIdPassword = this.config.get(ConfigSettings.GREENID_PASSWORD);

        if (this.config.get(ConfigSettings.GREENID_URL).includes("test")) {
            this.isTest = true;
        }
    }

    public async verify(data: VerifyUserRequest): Promise<KycResponse> {
        const greenIdUser: RegisterVerificationData = {
            ruleId: "default",
            name: data.fullName,
            currentResidentialAddress: data.address,
            dob: data.dob
        };

        // Map the type to Green ID required format
        const licence: LicenceData = {
            state: data.address.state,
            licenceNumber: data.driversLicence.licenceNumber,
            cardNumber: data.driversLicence.cardNumber,
            name: data.fullName,
            dob: data.dob
        };

        const medicare: MedicareData = {
            colour: data.medicareCard.colour,
            number: data.medicareCard.number,
            individualReferenceNumber:
                data.medicareCard.individualReferenceNumber.toString(),
            name: data.medicareCard.nameOnCard.toLocaleUpperCase(),
            dob: data.dob,
            expiry: data.medicareCard.expiry
        };

        const response: VerifyReturnData = await this._verify({
            user: greenIdUser,
            licence: licence,
            medicare: medicare
        });

        try {
            const result: KycResponse = await this.formatReturnData(response);
            this.logger.log(result);

            return result;
        } catch (error) {
            this.logger.error("Error formatting return data", error);

            const errorResult: KycResponse = {
                result: KycResult.Completed,
                thirdPartyVerified: false,
                signature: "",
                JWTs: []
            };
            return errorResult;
        }
    }

    private async _verify(dto: VerifyDTO): Promise<VerifyReturnData> {
        // const mock: VerifyReturnData = {
        //     success: true,
        //     didJWTCredentials: [],
        //     didPGPCredentials: []
        // };

        // // return mock
        // return Promise.resolve(mock);

        const { user, licence, medicare } = dto;
        let errorMessage: string;

        if (!user.name) errorMessage = "User doesn't have name";
        if (!user.dob) errorMessage = "User doesn't have a date of birth";

        if (errorMessage) {
            this.logger.error(errorMessage);
            throw new Error(errorMessage);
        }

        this.logger.log("Verifying with GreenID");

        const {
            return: {
                verificationResult: { verificationId }
            }
        } = await this.registerVerification(user);

        if (!licence) throw new Error("Licence not provided");
        if (!medicare) throw new Error("Medicare card not provided");

        const licenceResult: SetFieldResult = await this.setFields({
            verificationId,
            sourceId: `${licence.state.toLowerCase()}regodvs`,
            inputFields: {
                input: this.getDriversLicenseeInputs(licence)
            }
        });
        this.logger.log("Licence result complete");
        this.logger.log(licenceResult);

        if (licenceResult.return.checkResult.state !== "VERIFIED") {
            await this.setFields({
                verificationId,
                sourceId: `medicaredvs`,
                inputFields: {
                    input: this.getMedicareInputs(medicare)
                }
            });
        }

        const result = await this.getVerificationResult(verificationId);
        this.logger.log(
            `Verification result complete status ${result.return.verificationResult.overallVerificationStatus}`
        );

        if (
            result.return.verificationResult.overallVerificationStatus ===
                "VERIFIED" ||
            result.return.verificationResult.overallVerificationStatus ===
                "IN_PROGRESS" ||
            this.isTest
        ) {
            // const signedNameCredential =
            //     await this.createJWTVerifiableCredential(
            //         "NameCredential",
            //         user.name
            //     );

            // const signedDobCredential =
            //     await this.createJWTVerifiableCredential(
            //         "BirthCredential",
            //         user.dob
            //     );

            // const PGPSignedNameCredential =
            //     await this.createPGPVerifiableCredential(
            //         "NameCredential",
            //         user.name
            //     );

            // const PGPSignedDobCredential =
            //     await this.createPGPVerifiableCredential(
            //         "BirthCredential",
            //         user.dob
            //     );

            const signedNameCredentialPromise =
                this.createJWTVerifiableCredential("NameCredential", user.name);

            const signedDobCredentialPromise =
                this.createJWTVerifiableCredential("BirthCredential", user.dob);

            const PGPSignedNameCredentialPromise =
                this.createPGPVerifiableCredential("NameCredential", user.name);

            const PGPSignedDobCredentialPromise =
                this.createPGPVerifiableCredential("BirthCredential", user.dob);

            const [
                signedNameCredential,
                signedDobCredential,
                PGPSignedNameCredential,
                PGPSignedDobCredential
            ] = await Promise.all([
                signedNameCredentialPromise,
                signedDobCredentialPromise,
                PGPSignedNameCredentialPromise,
                PGPSignedDobCredentialPromise
            ]);

            this.logger.log("Credentials created");

            // CACHE THIS
            return {
                success: true,
                didJWTCredentials: [signedNameCredential, signedDobCredential],
                didPGPCredentials: [
                    PGPSignedNameCredential,
                    PGPSignedDobCredential
                ]
            };
        }

        throw new Error("Error, please contact support");
    }

    private async formatReturnData(
        data: VerifyReturnData
    ): Promise<KycResponse> {
        try {
            const pgpSign = false;
            let signature = ethers.constants.HashZero;

            // Get PGP password from config
            const pgpPassphrase = this.config.get(
                ConfigSettings.PGP_PASSPHRASE
            );

            this.logger.log(
                `PGP Passphrase configured: ${pgpPassphrase ? "Yes" : "No"}`
            );

            // Safely access PGP credentials with fallback
            const credentials = data.didPGPCredentials?.[0] || null;
            if (!credentials) {
                this.logger.warn(
                    "No PGP credentials found in verification data"
                );
            }

            const claimPayload = {
                "@context": [
                    "https://www.w3.org/2018/credentials/v1",
                    "https://schema.org"
                ],
                type: "VerifiablePresentation",
                proof: {
                    type: "EcdsaSecp256k1Signature2019",
                    created: new Date(),
                    proofPurpose: "authentication",
                    verificationMethod: `did:idem:${this.config.get(
                        ConfigSettings.WALLET_ADDRESS
                    )}`,
                    domain: this.config.get(ConfigSettings.IDEM_URL)
                },
                verifiableCredential: credentials ? [credentials] : []
            } as unknown as ClaimResponsePayload;

            const hashedPayload = ethers.utils.hashMessage(
                JSON.stringify(claimPayload)
            );

            if (pgpSign) {
                try {
                    signature = await signMessage(
                        hashedPayload,
                        this.config,
                        this.logger
                    );
                } catch (signError) {
                    this.logger.error(
                        "Failed to sign message with PGP:",
                        signError
                    );
                    signature = "";
                }
            }

            // Safely map JWTs with error handling
            let jwts = [];
            try {
                if (data.didJWTCredentials && data.didPGPCredentials) {
                    jwts = data.didJWTCredentials.map((jwt, index) => ({
                        claimType:
                            data.didPGPCredentials[index]?.type?.[1] ||
                            "Unknown",
                        jwt
                    }));
                }
            } catch (mappingError) {
                this.logger.error(
                    "Failed to map JWT credentials:",
                    mappingError
                );
                jwts = [];
            }

            return {
                result: KycResult.Completed,
                thirdPartyVerified: false,
                signature: signature,
                message: claimPayload,
                hashedPayload: hashedPayload,
                JWTs: jwts
            };
        } catch (error) {
            this.logger.error("Error in formatReturnData:", error);

            // Return a safe fallback response
            return {
                result: KycResult.Completed,
                thirdPartyVerified: false,
                signature: "",
                message: {
                    "@context": [
                        "https://www.w3.org/2018/credentials/v1",
                        "https://schema.org"
                    ],
                    type: "VerifiablePresentation",
                    proof: {
                        type: "EcdsaSecp256k1Signature2019",
                        created: new Date(),
                        proofPurpose: "authentication",
                        verificationMethod: `did:idem:${this.config.get(
                            ConfigSettings.WALLET_ADDRESS
                        )}`,
                        domain: this.config.get(ConfigSettings.IDEM_URL)
                    },
                    verifiableCredential: []
                } as unknown as ClaimResponsePayload,
                hashedPayload: "",
                JWTs: []
            };
        }
    }

    private async createJWTVerifiableCredential(
        credentialType: ClaimType,
        credentialSubject: object
    ): Promise<string> {
        const date = new Date();
        const yearFromNow = new Date(
            date.valueOf() + 1000 * 60 * 60 * 24 * 365
        );

        const publicKey = new ethers.Wallet(
            this.config.get(ConfigSettings.WALLET_PRIVATE_KEY)
        ).publicKey;

        const keypair = {
            address: this.config.get(ConfigSettings.WALLET_ADDRESS),
            privateKey: this.config.get(ConfigSettings.WALLET_PRIVATE_KEY),
            publicKey: publicKey,
            identifier: publicKey
        };

        const ethrDid = new EthrDID({ ...keypair });

        const unverifiableCredential: UnverifiableCredential = {
            "@context": ["https://www.w3.org/2018/credentials/v1"],
            type: ["VerifiableCredential", credentialType],
            issuer: ethrDid.did,
            issuanceDate: date.toISOString(),
            expirationDate: yearFromNow.toISOString(), //expires after 1 year
            credentialSubject: credentialSubject
        };

        try {
            const JWT = await ethrDid.signJWT({ vc: unverifiableCredential });

            return JWT;
        } catch (error) {
            this.logger.error(
                "Error creating JWT verifiable credential",
                error
            );
            return ethers.constants.HashZero;
        }
    }

    // Create verifiable credential signed with pgp key
    private async createPGPVerifiableCredential(
        credentialType: ClaimType,
        credentialSubject: object
    ): Promise<PGPVerifiableCredential> {
        const date = new Date();
        const yearFromNow = new Date(
            date.valueOf() + 1000 * 60 * 60 * 24 * 365
        );

        let signature = ethers.constants.HashZero;

        const UnverifiableCredential: UnverifiableCredential = {
            "@context": ["https://www.w3.org/2018/credentials/v1"],
            type: ["VerifiableCredential", credentialType],
            issuer: this.config.get(ConfigSettings.IDEM_URL),
            issuanceDate: date.toISOString(),
            expirationDate: yearFromNow.toISOString(), //expires after 1 year
            credentialSubject: credentialSubject
        };

        try {
            const privateKey = await getPrivateKey(this.config);
            if (!privateKey) {
                throw new Error("Failed to load PGP private key");
            }
            const message = await openpgp.createMessage({
                text: JSON.stringify(UnverifiableCredential)
            });
            const detachedSignature = await openpgp.sign({
                message: message,
                signingKeys: privateKey,
                format: "object",
                detached: true
            });

            const pgpSignature = await openpgp.readSignature({
                armoredSignature: detachedSignature.armor() // parse detached signature
            });

            signature = pgpSignature.armor();

            this.logger.log("PGP verifiable credential created");
        } catch (error) {
            this.logger.error(
                "Error creating PGP verifiable credential",
                error
            );
        } finally {
            return {
                ...UnverifiableCredential,
                proof: {
                    type: "GpgSignature2020",
                    created: new Date().toISOString(),
                    proofPurpose: "assertionMethod",
                    verificationMethod: "",
                    signatureValue: signature
                }
            };
        }
    }

    private async initialiseGreenIdClient(baseURL: string): Promise<void> {
        this.greenId = await new Promise<soap.Client>((resolve): void => {
            this.logger.log("Establishing GreenId connection");
            soapImport.createClient(
                baseURL,
                (error: unknown, client: soap.Client) => {
                    if (error || !client) {
                        this.logger.debug(
                            "Error establishing Green ID connection. Retrying...",
                            error
                        );
                        setTimeout(
                            () => this.initialiseGreenIdClient(baseURL),
                            5000
                        );
                    } else {
                        resolve(client);
                    }
                }
            );
        });
    }

    public async getSources(verificationId: string): Promise<Source[]> {
        return new Promise<Source[]>((resolve, reject) => {
            this.greenId.getSources(
                {
                    verificationId: verificationId,
                    accountId: this.greenIdAccountId,
                    password: this.greenIdPassword
                },
                (error: unknown, result: GetSourcesResult) => {
                    if (error) {
                        reject(error);
                    }

                    resolve(result?.return?.sourceList ?? []);
                }
            );
        });
    }

    private async getVerificationResult(
        verificationId: string
    ): Promise<GetVerificationResult> {
        this.logger.log("Getting verification result");

        return new Promise<GetVerificationResult>((resolve, reject) => {
            this.greenId.getSources(
                {
                    verificationId: verificationId,
                    accountId: this.greenIdAccountId,
                    password: this.greenIdPassword
                },
                (error: unknown, result: GetVerificationResult) => {
                    if (error) {
                        reject(error);
                    }

                    resolve(result);
                }
            );
        });
    }

    private async registerVerification(
        data: RegisterVerificationData
    ): Promise<RegisterVerificationResult> {
        return new Promise<RegisterVerificationResult>((resolve, reject) => {
            this.greenId.registerVerification(
                {
                    ...data,
                    accountId: this.greenIdAccountId,
                    password: this.greenIdPassword
                },
                (error: unknown, result: RegisterVerificationResult) => {
                    if (error) {
                        reject(error);
                    }

                    resolve(result);
                }
            );
        });
    }

    private async setFields(data: SetFieldsPayload): Promise<SetFieldResult> {
        return new Promise<SetFieldResult>((resolve, reject) => {
            this.greenId.setFields(
                {
                    ...data,
                    accountId: this.greenIdAccountId,
                    password: this.greenIdPassword
                },
                (error: unknown, result: SetFieldResult) => {
                    if (error) {
                        reject(error);
                    }

                    resolve(result);
                }
            );
        });
    }

    private getDriversLicenseeInputs(data: LicenceData) {
        const state = data.state.toLowerCase();
        const variables = [
            {
                name: `greenid_${state}regodvs_number`,
                value: data.licenceNumber
            },
            {
                name: `greenid_${state}regodvs_givenname`,
                value: data.name.givenName
            },
            {
                name: `greenid_${state}regodvs_surname`,
                value: data.name.surname
            },
            {
                name: `greenid_${state}regodvs_dob`,
                value: `${data.dob.day}/${data.dob.month}/${data.dob.year}`
            },
            {
                name: `greenid_${state}regodvs_tandc`,
                value: "on"
            },
            {
                name: `greenid_${state}regodvs_cardnumber`,
                value: data.cardNumber
            }
        ];

        if (data.name.middleNames) {
            variables.push({
                name: `greenid_${state}regodvs_middlename`,
                value: data.name.middleNames
            });
        }

        return variables;
    }

    private getMedicareInputs(data: MedicareData) {
        const variables = [
            {
                name: `greenid_medicaredvs_cardColour`,
                value: data.colour
            },
            {
                name: `greenid_medicaredvs_number`,
                value: data.number
            },
            {
                name: `greenid_medicaredvs_individualReferenceNumber`,
                value: data.individualReferenceNumber
            },
            {
                name: `greenid_medicaredvs_nameOnCard`,
                value: data.name
            },
            {
                name: `greenid_medicaredvs_dob`,
                value: `${data.dob.day}/${data.dob.month}/${data.dob.year}`
            },
            {
                name: `greenid_medicaredvs_expiry`,
                value: data.expiry
            },
            {
                name: `greenid_medicaredvs_tandc`,
                value: "on"
            }
        ];

        if (data.name2) {
            variables.push({
                name: `greenid_medicaredvs_nameLine2`,
                value: data.name2
            });
        }

        if (data.name3) {
            variables.push({
                name: `greenid_medicaredvs_nameLine3`,
                value: data.name3
            });
        }

        if (data.name4) {
            variables.push({
                name: `greenid_medicaredvs_nameLine4`,
                value: data.name4
            });
        }

        return variables;
    }

    private getPassportInputs(data: PassportData) {
        const variables = [
            {
                name: `greenid_passportdvs_number`,
                value: data.number
            },
            {
                name: `greenid_passportdvs_givenname`,
                value: data.name.givenName
            },
            {
                name: `greenid_passportdvs_surname`,
                value: data.name.surname
            },
            {
                name: `greenid_passportdvs_dob`,
                value: `${data.dob.day}/${data.dob.month}/${data.dob.year}`
            },
            {
                name: `greenid_passportdvs_tandc`,
                value: "on"
            }
        ];

        if (data.name.middleNames) {
            variables.push({
                name: `greenid_passportdvs_middlename`,
                value: data.name.middleNames
            });
        }

        return variables;
    }

    private getBirthCertificateInputs(data: BirthCertificateData) {
        const variables = [
            {
                name: `greenid_birthcertificatedvs_registration_number`,
                value: data.number
            },
            {
                name: `greenid_birthcertificatedvs_registration_state`,
                value: data.state
            },
            {
                name: `greenid_birthcertificatedvs_givenname`,
                value: data.name.givenName
            },
            {
                name: `greenid_birthcertificatedvs_surname`,
                value: data.name.surname
            },
            {
                name: `greenid_birthcertificatedvs_dob`,
                value: `${data.dob.day}/${data.dob.month}/${data.dob.year}`
            },
            {
                name: `greenid_birthcertificatedvs_tandc`,
                value: "on"
            }
        ];

        if (data.registrationYear) {
            variables.push({
                name: `greenid_birthcertificatedvs_registration_year`,
                value: data.registrationYear
            });
        }
        if (data.registrationDate) {
            variables.push({
                name: `greenid_birthcertificatedvs_registration_date`,
                value: data.registrationDate
            });
        }
        if (data.certificateNumber) {
            variables.push({
                name: `greenid_birthcertificatedvs_certificate_number`,
                value: data.certificateNumber
            });
        }
        if (data.certificatePrintedDate) {
            variables.push({
                name: `greenid_birthcertificatedvs_certificate_printed_date`,
                value: data.certificatePrintedDate
            });
        }
        if (data.name.middleNames) {
            variables.push({
                name: `greenid_birthcertificatedvs_middlename`,
                value: data.name.middleNames
            });
        }

        return variables;
    }
}
