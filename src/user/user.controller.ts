import {
    NotificationRequest,
    UserDto,
    IUserService,
    VerifyUserRequest,
    ResendEmailRequestBody,
    VerifyEmailRequestBody,
    IKYCService,
    IPartnerService
} from "./../interfaces";
import {
    Controller,
    Inject,
    Post,
    Headers,
    HttpStatus,
    Body,
    Get,
    Param,
    Put,
    UseGuards,
    UnauthorizedException,
    Ip
} from "@nestjs/common";
import { ApiOperation, ApiResponse } from "@nestjs/swagger";
import { User } from "../data/entities/user.entity";
import { Public } from "../auth/anonymous";
import { LocalGuard } from "../auth/auth-local.guard";
import { hashMessage } from "ethers/lib/utils";
import { KycResponse, UsersResponse } from "../types/general";
import { Request } from "../data/entities/request.entity";
import { logger } from "ethers";

@Controller("users")
@UseGuards(LocalGuard)
export class UserController {
    constructor(
        @Inject("IUserService") private userService: IUserService,
        @Inject("IKYCService") private kycService: IKYCService,
        // @Inject("IAccountingService")
        // private xeroService: IAccountingService,
        @Inject("IPartnerService") private partnerService: IPartnerService
    ) {}

    @Post("")
    @ApiOperation({ summary: "Create user" })
    @ApiResponse({
        status: HttpStatus.OK
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST
    })
    async createUser(@Body() body: UserDto): Promise<void> {
        return this.userService.create(body);
    }

    @Post("verify-claims")
    @ApiOperation({ summary: "Verify claims" })
    @ApiResponse({
        status: HttpStatus.OK
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST
    })
    async verify(
        @Body() body: VerifyUserRequest
        // @Headers("x-idem-api-key") apiKey: string,
        // @Ip() ip: string
    ): Promise<KycResponse> {
        // const partner = await this.partnerService.getByApiKey(apiKey);
        // if (!partner) {
        //     throw new UnauthorizedException("Invalid API key");
        // }

        // TODO: Check if the user is already verified

        // Verify the user
        const result = await this.kycService.verify(body);
        logger.info(result);
        // Cache the result

        // Add a request to the db
        const request = new Request();
        request.from = "GPIB";
        request.to = "IDEM";
        request.requestType = "Verify";
        request.ipAddress = "localhost";

        // logger.info(`Adding request ${request} to the database`);
        // await this.partnerService.create(request);

        // Send the result to the partner

        return result;
    }

    @Get("")
    @ApiOperation({ summary: "Get users" })
    @ApiResponse({
        status: HttpStatus.OK
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST
    })
    async getAll(): Promise<UsersResponse[]> {
        return this.userService.findAll();
    }

    @Put(":email")
    @ApiOperation({ summary: "Update user" })
    @ApiResponse({
        status: HttpStatus.OK
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST
    })
    async update(
        @Param("email") email: string,
        @Body() requestBody: UserDto
    ): Promise<User> {
        return this.userService.update(email, requestBody);
    }

    @Post("notify")
    @ApiOperation({ summary: "Push notification" })
    @ApiResponse({
        status: HttpStatus.OK
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST
    })
    async pushNotifications(
        @Body() request: NotificationRequest
    ): Promise<void> {
        return this.userService.pushNotifications(request.message);
    }

    @ApiOperation({
        summary: "Get user detail"
    })
    @ApiResponse({
        status: HttpStatus.OK
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST
    })
    @Get(":email")
    async getUser(
        @Param("email") email: string
    ): Promise<UsersResponse | undefined> {
        const formattedEmail = email.trim().toLowerCase();
        const hashEmail = hashMessage(formattedEmail);
        return this.userService.findOne(hashEmail);
    }

    @Public()
    @ApiOperation({
        summary: "Verify email"
    })
    @ApiResponse({
        status: HttpStatus.OK
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST
    })
    @Post("verify-email")
    async verifyEmail(@Body() body: VerifyEmailRequestBody): Promise<boolean> {
        return this.userService.verifyEmail(body);
    }

    // // TODO:  Remove this should be on partner controller
    // @ApiOperation({
    //     summary: "Send invoices"
    // })
    // @ApiResponse({
    //     status: HttpStatus.OK
    // })
    // @ApiResponse({
    //     status: HttpStatus.BAD_REQUEST
    // })
    // @Post("send-invoices")
    // async sendInvoices(@Body() body: SendInvoicesRequestBody): Promise<string> {
    //     return this.xeroService.sendInvoices(body);
    // }

    @ApiOperation({
        summary: "Resend email verification"
    })
    @ApiResponse({
        status: HttpStatus.OK
    })
    @ApiResponse({
        status: HttpStatus.BAD_REQUEST
    })
    @Post("resend-email")
    async resendEmailVerification(
        @Body() body: ResendEmailRequestBody
    ): Promise<boolean> {
        return this.userService.resendEmailVerification(body.hashedEmail);
    }
}
