import { ClaimResponsePayload, ClaimType } from "./verification";

// String values used in user-facing error messages
export enum EntityNames {
    Account = "Account"
}

export enum KycResult {
    InProgress = "in_progress",
    Completed = "completed",
    Failed = "failed"
}

export enum RequestType {
    Signup = "Signup",
    Verify = "Verify"
}

//Add more venders
export enum VendorEnum {
    GPIB = 1,
    CoinStash = 2,
    DigitalSurge = 5,
    EasyCrypto = 6
}

export enum ConfigSettings {
    EXPO_ACCESS_TOKEN = "EXPO_ACCESS_TOKEN",
    KYC_URL = "KYC_URL",
    KYC_CLIENT_ID = "KYC_CLIENT_ID",
    KYC_CLIENT_SECRET = "KYC_CLIENT_SECRET",
    GPIB_API_ENDPOINT = "GPIB_API_ENDPOINT",
    COINSTASH_SIGNUP_ENDPOINT = "COINSTASH_SIGNUP_ENDPOINT",
    COINSTASH_TOKEN = "COINSTASH_TOKEN",
    APP_DEEPLINK_URL = "APP_DEEPLINK_URL",
    EC_SIGNUP_ENDPOINT = "EC_SIGNUP_ENDPOINT",
    DIGITALSURGE_SIGNUP_ENDPOINT = "DIGITALSURGE_SIGNUP_ENDPOINT",
    DIGITALSURGE_PARTNER_TOKEN = "DIGITALSURGE_PARTNER_TOKEN",
    WALLET_PRIVATE_KEY = "WALLET_PRIVATE_KEY",
    WALLET_ADDRESS = "WALLET_ADDRESS",
    IDEM_URL = "IDEM_URL",
    OTP_HASHING_SECRET = "OTP_HASHING_SECRET",
    OTP_HASHING_SALT = "OTP_HASHING_SALT",
    OTP_EXPIRY_TIME = "OTP_EXPIRY_TIME",
    MESSAGEBIRD_API_KEY = "MESSAGEBIRD_API_KEY",
    HTTPS_PROXY_HOST = "HTTPS_PROXY_HOST",
    HTTPS_PROXY_PORT = "HTTPS_PROXY_PORT",
    HTTPS_PROXY_PASSWORD = "HTTPS_PROXY_PASSWORD",
    HTTPS_PROXY_USERNAME = "HTTPS_PROXY_USERNAME",
    MAILJET_API_KEY = "MAILJET_API_KEY",
    MAILJET_SECRET = "MAILJET_SECRET",
    FROM_EMAIL_ADDRESS = "FROM_EMAIL_ADDRESS",
    WEBSITE_URL = "WEBSITE_URL",
    JWT_SECRET = "JWT_SECRET",
    JWT_EXPIRATION_SECONDS = "JWT_EXPIRATION_SECONDS",
    PGP_PASSPHRASE = "PGP_PASSPHRASE",
    PGP_PRIVATE_KEY = "PGP_PRIVATE_KEY",
    XERO_CLIENT_ID = "XERO_CLIENT_ID",
    XERO_CLIENT_SECRET = "XERO_CLIENT_SECRET",
    XERO_TENANT_ID = "XERO_TENANT_ID",
    XERO_SALES_CODE = "XERO_SALES_CODE",
    XERO_PRICE = "XERO_PRICE",
    XERO_GPIB_ID = "XERO_GPIB_ID",
    GPIB_REFERRAL_CODE = "GPIB_REFERRAL_CODE",
    GREENID_URL = "GREENID_URL",
    GREENID_ACCOUNT_ID = "GREENID_ACCOUNT_ID",
    GREENID_PASSWORD = "GREENID_PASSWORD",
    REALLY_VERIFY_IDENTITY = "REALLY_VERIFY_IDENTITY"
}

export type UsersResponse = {
    userId: string;
    email: string;
    createdAt: Date;
    emailVerified: boolean;
};

export type KycResponse = {
    result: KycResult;
    thirdPartyVerified: boolean;
    signature?: string; //signed claim response
    message?: ClaimResponsePayload;
    hashedPayload?: string;
    JWTs: JWT[];
};

export type JWT = {
    claimType: ClaimType;
    jwt: string;
};

export type GPIBVerifyRequest = {
    phoneNumber: string;
    email: string;
    userID: string;
    phoneNumberVerified: boolean;
    emailVerified: boolean;
    idVerified: boolean;
};

export type RequestOtpResponse = {
    hash: string;
    expiryTimestamp: number;
};

export type SignupResponse = {
    userId: string;
    password?: string;
};

export type AuthToken = {
    access_token: string;
    refresh_token: number;
};

// all optional params as documented by Xero
export type XeroTokenSet = AuthToken & {
    token_type?: string;
    id_token?: string;
    expires_in?: number;
    session_state?: string;
    scope?: string;
};

export type SimpleEmailParams = {
    to: string;
    toName: string;
    subject: string;
};

export type RawEmailParams = SimpleEmailParams & {
    text: string;
};
