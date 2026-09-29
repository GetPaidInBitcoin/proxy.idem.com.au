import { expect } from "chai";
import { BadRequestException, Logger } from "@nestjs/common";
import { GreenIdService } from "./GreenIdService";

// Build the service without its constructor, which opens a SOAP client to
// greenID. Every greenID call a test reaches is stubbed on the instance.
const makeService = (overrides: Record<string, unknown> = {}) => {
    const svc = Object.create(GreenIdService.prototype);
    svc.logger = new Logger("GreenIdServiceSpec");
    svc.isTest = false;
    return Object.assign(svc, overrides);
};

const request = (dvsConsent: unknown) => ({
    fullName: { givenName: "Jane", surname: "Citizen" },
    dob: { day: 1, month: 2, year: 1990 },
    emailHash: "hash",
    address: { state: "TAS" },
    driversLicence: { licenceNumber: "123456", cardNumber: "C1234567" },
    medicareCard: {
        colour: "GREEN",
        number: "2123456701",
        nameOnCard: "J CITIZEN",
        individualReferenceNumber: "1",
        expiry: "12/2030"
    },
    dvsConsent
});

const dto = (status: string) => ({
    user: { name: { givenName: "Jane" }, dob: { day: 1 } },
    licence: { state: "TAS" },
    medicare: {},
    dvsConsent: true,
    status
});

// greenID stubs: licence not verified (so medicare runs too), then the
// overall status under test.
const greenIdStubs = (overallStatus: string, calls: string[]) => ({
    registerVerification: async () => {
        calls.push("register");
        return { return: { verificationResult: { verificationId: "v1" } } };
    },
    setFields: async () => {
        calls.push("setFields");
        return { return: { checkResult: { state: "IN_PROGRESS" } } };
    },
    getVerificationResult: async () => ({
        return: {
            verificationResult: { overallVerificationStatus: overallStatus }
        }
    }),
    getDriversLicenseeInputs: () => [],
    getMedicareInputs: () => [],
    createJWTVerifiableCredential: async () => "jwt",
    createPGPVerifiableCredential: async () => "pgp"
});

describe("GreenIdService DVS consent and result handling (#1886)", () => {
    it("refuses a check without express consent, before contacting greenID", async () => {
        for (const consent of [false, undefined, "true", 1]) {
            const calls: string[] = [];
            const svc = makeService(greenIdStubs("VERIFIED", calls));
            let error: unknown;
            try {
                await svc.verify(request(consent));
            } catch (e) {
                error = e;
            }
            expect(error, `consent=${String(consent)}`).to.be.instanceOf(
                BadRequestException
            );
            expect(calls, `consent=${String(consent)}`).to.deep.equal([]);
        }
    });

    it("sends greenID's tandc field only when consent was given", () => {
        const svc = makeService();
        expect(svc.tandcInput("greenid_medicaredvs_tandc", true)).to.deep.equal(
            [{ name: "greenid_medicaredvs_tandc", value: "on" }]
        );
        expect(svc.tandcInput("greenid_medicaredvs_tandc", false)).to.deep.equal(
            []
        );
    });

    it("includes tandc in licence and medicare inputs only with consent", () => {
        const svc = makeService();
        const licence = {
            state: "TAS",
            licenceNumber: "123456",
            cardNumber: "C1",
            name: { givenName: "Jane", surname: "Citizen" },
            dob: { day: 1, month: 2, year: 1990 }
        };
        const medicare = {
            colour: "GREEN",
            number: "2123456701",
            individualReferenceNumber: "1",
            name: "J CITIZEN",
            dob: { day: 1, month: 2, year: 1990 },
            expiry: "12/2030"
        };
        const names = (inputs: { name: string }[]) => inputs.map((i) => i.name);

        expect(names(svc.getDriversLicenseeInputs(licence, true))).to.include(
            "greenid_tasregodvs_tandc"
        );
        expect(
            names(svc.getDriversLicenseeInputs(licence, false))
        ).to.not.include("greenid_tasregodvs_tandc");
        expect(names(svc.getMedicareInputs(medicare, true))).to.include(
            "greenid_medicaredvs_tandc"
        );
        expect(names(svc.getMedicareInputs(medicare, false))).to.not.include(
            "greenid_medicaredvs_tandc"
        );
    });

    it("does not treat an IN_PROGRESS result as verified", async () => {
        const svc = makeService(greenIdStubs("IN_PROGRESS", []));
        let error: unknown;
        try {
            await svc._verify(dto("IN_PROGRESS"));
        } catch (e) {
            error = e;
        }
        expect(error).to.be.instanceOf(Error);
    });

    it("still passes a VERIFIED result", async () => {
        const svc = makeService(greenIdStubs("VERIFIED", []));
        const result = await svc._verify(dto("VERIFIED"));
        expect(result.success).to.equal(true);
    });
});
