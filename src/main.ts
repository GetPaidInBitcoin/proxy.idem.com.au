import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { GenericInterceptor } from "./utils/interceptors";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import tracer from "dd-trace";
import { NestExpressApplication } from "@nestjs/platform-express";

async function bootstrap() {
    tracer.init();
    const app = await NestFactory.create<NestExpressApplication>(AppModule, {
        cors: {
            origin: true, // Allow all origins
            methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
            allowedHeaders: [
                "Origin",
                "X-Requested-With",
                "Content-Type",
                "Accept",
                "Authorization",
                "X-API-Key",
                "x-idem-api-key"
            ],
            credentials: true,
            preflightContinue: false,
            optionsSuccessStatus: 204
        }
    });

    // Enable CORS explicitly for all routes
    app.enableCors({
        origin: true,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: [
            "Origin",
            "X-Requested-With",
            "Content-Type",
            "Accept",
            "Authorization",
            "X-API-Key",
            "x-idem-api-key"
        ],
        credentials: true
    });

    app.useGlobalPipes(
        new ValidationPipe({
            whitelist: true
        })
    );
    app.useGlobalInterceptors(new GenericInterceptor());

    const options = new DocumentBuilder()
        .setTitle("Idem Proxy API")
        .setDescription("Proxy requests to exchanges")
        .setVersion("1.1")
        .addBasicAuth()
        .addServer("http://localhost:3000", "Local development")
        .addServer("https://proxy.idem.com.au", "Production")
        .build();
    const document = SwaggerModule.createDocument(app, options);

    SwaggerModule.setup("swagger", app, document, {
        swaggerOptions: {
            persistAuthorization: true,
            tryItOutEnabled: true,
            requestInterceptor: request => {
                // Add any custom headers for Swagger requests
                return request;
            }
        },
        customCss: ".swagger-ui .topbar { display: none }",
        customSiteTitle: "Idem Proxy API Documentation"
    });

    await app.listen(process.env.PORT || 3000);
}
bootstrap();
