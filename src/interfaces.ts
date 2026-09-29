import {
    IsBoolean,
    IsEnum,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsString,
    ValidateNested
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { User } from "./data/entities/user.entity";
import { ClaimResponsePayload } from "./types/verification";
import { Type } from "class-transformer";
import {
    EntityNames,
    JWT,
    KycResponse,
    KycResult,
    RequestOtpResponse,
    SignupResponse,
    UsersResponse,
    VendorEnum,
    XeroTokenSet
} from "./types/general";
import {
    Address,
    DOB,
    Fullname,
    LicenceData,
    MedicareData,
    RegisterVerificationData,
    VerifyDTO,
    VerifyReturnData
} from "./types/greenId";

import { Request } from "./data/entities/request.entity";
import { Partner } from "./data/entities/partner.entity";

export interface IExampleService {
    getById(id: string): string;
    getAll(): string[];
}

//=== Abstract Error classes
export abstract class EntityMissingIdError extends Error {
    constructor(entity: string) {
        super(`${entity} ID is missing`);
    }
}

export abstract class EntityCannotGetError extends Error {
    constructor(entity: string, id: string, msg: string) {
        super(`Cannot get ${entity} ${id}: ${msg}`);
    }
}

export class EntityNotFoundError extends EntityCannotGetError {
    constructor(entity: string, entityId: string) {
        super(entity, entityId, `No ${entity} with ID "${entityId}"`);
    }
}

export class EntityCannotUpdateError extends Error {
    constructor(entity: string, entityId: string, msg: string) {
        super(`Cannot update ${entity} ${entityId}: ${msg}`);
    }
}

export class EntityCannotCreateError extends Error {
    constructor(entity: string, msg: string) {
        super(`Cannot create ${entity}: ${msg}`);
    }
}

//=== Account errors
export class AccountCannotGetError extends EntityCannotGetError {
    constructor(id: string, msg: string) {
        super(EntityNames.Account, id, msg);
    }
}

export class AccountNotFoundError extends EntityNotFoundError {
    constructor(accountId: string) {
        super(EntityNames.Account, accountId);
    }
}

export class AccountMissingIdError extends EntityMissingIdError {
    constructor() {
        super(EntityNames.Account);
    }
}

export interface IKYCService {
    // formatReturnData(data: VerifyReturnData): Promise<KycResponse>;
    verify(data: VerifyUserRequest): Promise<KycResponse>;
}

export interface ISmsService {
    send(phoneNumber: string, message: string): Promise<void>;
}

export interface IUserService {
    // verify(body: VerifyUserRequest): Promise<string>;
    findOne(hashEmail: string): Promise<UsersResponse>;
    findAll(): Promise<UsersResponse[]>;
    create(newUser: UserDto): Promise<void>;
    update(userId: string, requestBody: UserDto): Promise<User>;

    pushNotifications(message: string): Promise<void>;
    verifyEmail(body: VerifyEmailRequestBody): Promise<boolean>;
    // decodeEmailFromToken(token: string): Promise<string>;
    // sendInvoices(body: SendInvoicesRequestBody): Promise<string>;
    resendEmailVerification(hashedEmail: string): Promise<boolean>;
}

export interface IOauthService {
    refreshTokens(): Promise<void>;
}

export interface IOtpService {
    requestOtp(mobile: string): Promise<RequestOtpResponse>;
    verifyOtp(body: VerifyOtp): Promise<boolean>;
}

export interface IEmailService {
    sendEmailVerification(
        email: string,
        verificationCode: string,
        recipientPublicKey: string
    ): Promise<void>;
}

export interface IExchangeService {
    pushSignupNotification(
        signupRequest: ExchangeSignupCallBack,
        ip: string
    ): Promise<void>;
    requests(): Promise<Request[]>;
    // TODO: CHANGE TO PRIMARY KEY
    signups(to: string): Promise<Request[]>;
}

export interface IPartnerService {
    create(request: Request): Promise<void>;
    get(): Promise<Partner[]>;
    getById(vendorId: number): Promise<Partner>;
    getByApiKey(apiKey: string): Promise<Partner>;
    getByEmail(email: string): Promise<Partner>;
    requests(): Promise<Request[]>;
    signUp(signupInfo: UserSignupRequest, ip: string): Promise<SignupResponse>;
}

export type LoginRequest = {
    email: string;
    password: string;
};

// Respponse from partner logins
export type AuthenticatedUser = {
    id: string;
    email: string;
    role: string;
    token: string;
};

export interface IVendor {
    name: string;
    signUp(signupInfo: UserSignupRequest): Promise<{
        userId: string;
        password?: string;
    }>;
}

export interface IAccountingService {
    sendInvoices(body: SendInvoicesRequestBody): Promise<string>;
}

export class UserDto {
    @ApiProperty()
    @IsNotEmpty()
    email: string;
    @ApiProperty()
    @IsOptional()
    expoToken: string;
    @ApiProperty()
    @IsOptional()
    pgpPublicKey: string;
    @ApiProperty()
    @IsOptional()
    nonce: string;
    @ApiProperty()
    @IsOptional()
    pgpSignedNonce: string;
}

export class LicenceDataDto {
    @ApiProperty()
    @IsNotEmpty()
    licenceNumber: string;
    @ApiProperty()
    @IsNotEmpty()
    cardNumber: string;
}

export class MedicareDataDto {
    @ApiProperty()
    @IsNotEmpty()
    colour: string;
    @ApiProperty()
    @IsNotEmpty()
    number: string;
    @ApiProperty()
    @IsNotEmpty()
    nameOnCard: string;
    @ApiProperty()
    @IsNotEmpty()
    individualReferenceNumber: string;
    @ApiProperty()
    @IsNotEmpty()
    expiry: string;
}

export class VerifyUserRequest {
    @ApiProperty()
    @IsNotEmpty()
    fullName: Fullname;
    @ApiProperty()
    @IsNotEmpty()
    dob: DOB;
    @ApiProperty()
    @IsNotEmpty()
    emailHash: string;
    @ApiPropertyOptional()
    @IsOptional()
    address: Address;
    @ApiProperty()
    @IsNotEmpty()
    driversLicence: LicenceDataDto;
    @ApiProperty()
    @IsNotEmpty()
    medicareCard: MedicareDataDto;
    // Express DVS consent (DVS Access Guidelines 2.51(a)). The GPIB API only
    // sends true after the customer ticked the model consent statement, or
    // staff attested it. Declared so ValidationPipe({ whitelist }) keeps it.
    @ApiProperty({
        description:
            "Express DVS consent captured from the individual. Checks are refused unless true."
    })
    @IsBoolean()
    dvsConsent: boolean;
}

export class ExchangeSignupCallBack {
    @ApiProperty()
    @IsNotEmpty()
    source: string;
    @ApiProperty({
        example: "message with deep link"
    })
    @IsNotEmpty()
    message: string;
    @ApiProperty({
        example: "hashed email address"
    })
    @IsNotEmpty()
    email: string; //need to passing hashed email address
}

class Verification implements KycResponse {
    @ApiProperty()
    @IsNotEmpty()
    @IsString()
    signature: string; //signed claim response
    @ApiProperty()
    @IsNotEmpty()
    @IsObject()
    message: ClaimResponsePayload;
    @ApiProperty()
    @IsNotEmpty()
    @IsEnum(KycResult)
    result: KycResult;
    @ApiProperty()
    @IsNotEmpty()
    @IsBoolean()
    thirdPartyVerified: boolean;
    @ApiProperty()
    @IsNotEmpty()
    hashedPayload: string;
    @ApiProperty()
    @IsNotEmpty()
    JWTs: JWT[];
}

export class UserSignupRequest {
    @ApiProperty({
        example: ["1", "2"]
    })
    @IsNotEmpty()
    source: number;
    @ApiProperty()
    @IsNotEmpty()
    firstName: string;
    @ApiProperty()
    @IsNotEmpty()
    lastName: string;
    @ApiProperty()
    @IsOptional()
    password: string;
    @ApiProperty()
    @IsNotEmpty()
    email: string;
    @ApiProperty()
    @IsOptional()
    mobile: string;
    @ApiProperty()
    @ValidateNested()
    @Type(() => Verification)
    verification: Verification;
    @ApiProperty()
    @IsOptional()
    dob: string;
}

export class UserDetailRequest {
    @ApiProperty()
    @IsNotEmpty()
    source: number;
    @ApiProperty()
    @IsNotEmpty()
    email: string;
    @ApiProperty()
    @IsNotEmpty()
    password: string;
    @ApiProperty()
    @IsNotEmpty()
    firstName: string;
    @ApiProperty()
    @IsNotEmpty()
    lastName: string;
    @ApiProperty()
    @IsNotEmpty()
    dob: string;
}

export class VerifyOtp {
    @ApiProperty()
    @IsNotEmpty()
    code: string;
    @ApiProperty()
    @IsNotEmpty()
    expiryTimestamp: number;
    @ApiProperty()
    @IsNotEmpty()
    mobileNumber: string;
    @ApiProperty()
    @IsNotEmpty()
    hash: string;
}

export class NotificationRequest {
    @ApiProperty()
    @IsNotEmpty()
    message: string;
}

export class ResendEmailRequestBody {
    @ApiProperty()
    @IsNotEmpty()
    hashedEmail: string;
}

export type InvoiceResponse = {
    invoiceId: string;
    invoiceNumber: string;
    invoiceDate: string;
    dueDate: string;
    amount: number;
    currency: string;
    status: string;
};

export class SendInvoicesRequestBody {
    @ApiProperty()
    @IsNotEmpty()
    authToken: XeroTokenSet;
    @ApiProperty()
    @IsNotEmpty()
    vendor: VendorEnum;
}

export type InvoiceDTO = {
    number: string;
    issuedDate: Date;
    dueDate: Date;
    total: number;
    currency: string;
    status: string;
};

export class VerifyEmailRequestBody {
    @ApiProperty()
    @IsNotEmpty()
    verificationCode: string;

    @ApiProperty()
    @IsNotEmpty()
    email: string;
}

export type RefreshToken = {
    refreshToken: string;
    accessToken: string;
};

export enum VendorName {
    GPIB = "Get Paid In Bitcoin",
    CoinStash = "Coin Stash",
    EasyCrypto = "Easy Crypto",
    DigitalSurge = "Digital Surge"
}

export type Vendor = {
    id: number;
    description: string;
    logo: string;
    name: string;
    signup: string;
    tagline: string;
    website: string;
    backgroundColor: string;
    requiredClaimTypes: RequiredClaimType[];
    useProxy: boolean;
    tempPassword: boolean;
    passwordComplexity: string;
    verifyClaims: boolean;
    enabled: boolean;
};

export type RequiredClaimType = {
    type: ClaimType;
    verified: boolean;
};

export type ClaimType =
    | "AdultCredential"
    | "BirthCredential"
    | "NameCredential"
    | "EmailCredential"
    | "MobileCredential"
    | "AddressCredential"
    | "TaxCredential"
    | "ProfileImageCredential";
