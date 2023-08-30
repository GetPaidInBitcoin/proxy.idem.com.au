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
    private greenIdAccountId: string;
    private greenIdPassword: string;

    constructor(private config: ConfigService) {
        this.initialiseGreenIdClient(config.get(ConfigSettings.GREENID_URL));
        this.greenIdAccountId = this.config.get(
            ConfigSettings.GREENID_ACCOUNT_ID
        );
        this.greenIdPassword = this.config.get(ConfigSettings.GREENID_PASSWORD);
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
            state: "QLD", // body.address.state,
            licenceNumber: data.driversLicence.licenceNumber,
            cardNumber: data.driversLicence.cardNumber,
            name: data.fullName,
            dob: data.dob
        };

        const medicare: MedicareData = {
            colour: "Green", // body.medicareCard.colour,
            number: data.medicareCard.number,
            individualReferenceNumber:
                data.medicareCard.individualReferenceNumber.toString(),
            name: data.medicareCard.nameOnCard.toLocaleUpperCase(),
            dob: data.dob,
            expiry: data.medicareCard.expiry
        };

        const response = await this._verify({
            user: greenIdUser,
            licence: licence,
            medicare: medicare
        });

        const result: KycResponse = await this.formatReturnData(response);
        this.logger.log(result);

        return result;
    }

    private async _verify(dto: VerifyDTO): Promise<VerifyReturnData> {
        const { user, licence, medicare } = dto;
        let errorMessage: string;

        if (!user.name) errorMessage = "User doesn't have name";
        if (!user.dob) errorMessage = "User doesn't have a date of birth";

        if (errorMessage) {
            this.logger.error(errorMessage);
            throw new Error(errorMessage);
        }

        this.logger.log("Verifying with GreenID");

        // if (
        //     this.config.get(ConfigSettings.REALLY_VERIFY_IDENTITY) === "false"
        // ) {
        //     this.mockGreenIdCall(_props);
        // }

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
        this.logger.log("Verification result complete");
        // this.logger.log(result);

        if (
            result.return.verificationResult.overallVerificationStatus ===
            "VERIFIED"
        ) {
            const signedNameCredential =
                await this.createJWTVerifiableCredential(
                    "NameCredential",
                    user.name
                );
            const signedDobCredential =
                await this.createJWTVerifiableCredential(
                    "BirthCredential",
                    user.dob
                );

            const PGPSignedNameCredential =
                await this.createPGPVerifiableCredential(
                    "NameCredential",
                    user.name
                );
            const PGPSignedDobCredential =
                await this.createPGPVerifiableCredential(
                    "BirthCredential",
                    user.dob
                );

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
        const credentials = data.didPGPCredentials[0];

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
            verifiableCredential: [credentials]
        } as unknown as ClaimResponsePayload;

        const hashedPayload = ethers.utils.hashMessage(
            JSON.stringify(claimPayload)
        );

        return {
            result: KycResult.Completed,
            thirdPartyVerified: false,
            signature: await signMessage(
                hashedPayload,
                this.config,
                this.logger
            ),
            message: claimPayload,
            hashedPayload: hashedPayload,
            JWTs: data.didJWTCredentials.map((jwt, index) => ({
                claimType: data.didPGPCredentials[index].type[1],
                jwt
            }))
        };
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

        const JWT = await ethrDid.signJWT({ vc: unverifiableCredential });

        return JWT;
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

        const UnverifiableCredential: UnverifiableCredential = {
            "@context": ["https://www.w3.org/2018/credentials/v1"],
            type: ["VerifiableCredential", credentialType],
            issuer: this.config.get(ConfigSettings.IDEM_URL),
            issuanceDate: date.toISOString(),
            expirationDate: yearFromNow.toISOString(), //expires after 1 year
            credentialSubject: credentialSubject
        };

        const privateKey = await getPrivateKey(this.config);
        const message = await openpgp.createMessage({
            text: JSON.stringify(UnverifiableCredential)
        });
        const detachedSignature = await openpgp.sign({
            message: message,
            signingKeys: privateKey,
            format: "object",
            detached: true
        });

        const signature = await openpgp.readSignature({
            armoredSignature: detachedSignature.armor() // parse detached signature
        });

        return {
            ...UnverifiableCredential,
            proof: {
                type: "GpgSignature2020",
                created: new Date().toISOString(),
                proofPurpose: "assertionMethod",
                verificationMethod: "",
                signatureValue: signature.armor()
            }
        };
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
