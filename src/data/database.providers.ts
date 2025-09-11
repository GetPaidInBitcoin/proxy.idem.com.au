import { DataSource } from "typeorm";
import * as fs from "fs";
import { Request } from "./entities/request.entity";
import { Partner } from "./entities/partner.entity";
import { User } from "./entities/user.entity";
import { Setting } from "./entities/setting.entity";

export const databaseProviders = [
    {
        provide: "DATA_SOURCE",
        useFactory: async () => {

            // Read ca.cert file if exists off disk
            let caCert = null;
            if (process.env.CA_CERT) {
                try {
                    caCert = fs.readFileSync(process.env.CA_CERT).toString();
                } catch (error) {
                    console.error(`Error reading CA certificate: ${error.message}`);
                }
            }

            const dataSource = new DataSource({
                type: "postgres",
                host: process.env.POSTGRES_HOST,
                port: Number(process.env.POSTGRES_PORT),
                username: process.env.POSTGRES_USER,
                password: process.env.POSTGRES_PASSWORD,
                database: process.env.POSTGRES_DB_NAME,
                // entities: [__dirname + "/../**/*.entity{.ts,.js}"],
                entities: [Partner, Request, Setting, User],
                ssl: process.env.CA_CERT
                    ? {
                        rejectUnauthorized: true,
                        ca: caCert
                    }
                    : false
            });

            return dataSource.initialize();
        }
    }
];
