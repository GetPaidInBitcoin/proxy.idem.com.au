import { Inject, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Logger } from "ethers/lib/utils";
import { Repository } from "typeorm";
import { Request } from "../data/entities/request.entity";
import { Contact, XeroClient, LineItem, Invoice, Invoices } from "xero-node";
import {
    IOauthService,
    IAccountingService,
    SendInvoicesRequestBody
} from "../interfaces";
import { getVendorId } from "../utils/vendor";
import { AuthToken, ConfigSettings } from "../types/general";
import { setCache } from "../clients/cache";

const XERO_SCOPES =
    "openid profile email accounting.transactions accounting.contacts offline_access";
const XERO_INVOICE_DESCRIPTION = "KYC";

@Injectable()
export class XeroService implements IAccountingService, IOauthService {
    private readonly client: XeroClient;
    private readonly logger = new Logger("XeroService");
    private accountCode;
    private price;
    private tenantId;

    constructor(
        private config: ConfigService,
        @Inject("REQUEST_REPOSITORY")
        private requestRepository: Repository<Request>
    ) {
        this.client = new XeroClient({
            clientId: this.config.get(ConfigSettings.XERO_CLIENT_ID),
            clientSecret: this.config.get(ConfigSettings.XERO_CLIENT_SECRET),
            scopes: XERO_SCOPES.split(" ")
        });
        this.accountCode = this.config.get(ConfigSettings.XERO_SALES_CODE);
        this.price = this.config.get(ConfigSettings.XERO_PRICE);
        this.tenantId = this.config.get(ConfigSettings.XERO_TENANT_ID);
    }

    public async refreshTokens(): Promise<void> {
        // call Xero API to refresh tokens

        // add tokens to Redis
        // await setCache<AuthToken>("redis", undefined, 2 * 60 * 60);
    }

    public async sendInvoices(body: SendInvoicesRequestBody): Promise<string> {
        const { authToken, vendor } = body;
        try {
            // set the auth token from the POST request body
            // const token = await getCache<AuthToken>("xero-token");
            // this.client.setTokenSet(authToken.access_token);

            // create xero contact
            const { contactName, contactID } = getVendorId(vendor, this.config);

            const contact: Contact = {
                contactID
            };

            // get requests from the request db
            const totalRequests = await this.requestRepository.count({
                where: {
                    to: contactName
                }
            });

            // construct a line item for all KYC invoices
            const lineItems: LineItem[] = [
                {
                    description: XERO_INVOICE_DESCRIPTION,
                    quantity: totalRequests,
                    unitAmount: +this.price,
                    accountCode: this.accountCode
                }
            ];

            // construct invoices object that contains single invoice for vendor
            const invoices: Invoices = {
                invoices: [
                    {
                        type: Invoice.TypeEnum.ACCREC,
                        contact,
                        date: new Date().toLocaleDateString("en-US"),
                        lineItems,
                        reference: `${contactName} Invoice`,
                        status: Invoice.StatusEnum.DRAFT
                    }
                ]
            };

            // create xero invoices
            await this.client.accountingApi.createInvoices(
                this.tenantId,
                invoices
            );

            // user-facing success message
            this.logger.debug("Invoices sent");
            return "Invoices sent";
        } catch (err: unknown) {
            this.logger.debug("Error when sending invoices", err);
            throw new Error(JSON.stringify(err));
        }
    }
}
