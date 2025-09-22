import Redis from "ioredis";

let _redisClient: Redis;
let _redisAvailable = true;
let _redisConnectionTested = false;

export const redisClient = () => {
    if (!_redisClient && _redisAvailable) {
        try {
            _redisClient = new Redis(process.env.REDIS_URL, {
                maxRetriesPerRequest: 3,
                connectTimeout: 5000,
                lazyConnect: true
            });

            // Handle connection errors
            _redisClient.on("error", error => {
                console.error("Redis connection error:", error.message);
                _redisAvailable = false;
                _redisConnectionTested = true;
            });

            _redisClient.on("connect", () => {
                console.log("Redis connected successfully");
                _redisAvailable = true;
                _redisConnectionTested = true;
            });

            _redisClient.on("reconnecting", () => {
                console.log("Redis reconnecting...");
            });

            _redisClient.on("ready", () => {
                console.log("Redis ready for operations");
                _redisAvailable = true;
            });
        } catch (error) {
            console.error("Failed to initialize Redis client:", error.message);
            _redisAvailable = false;
            _redisConnectionTested = true;
        }
    }
    return _redisClient;
};

const testRedisConnection = async (): Promise<boolean> => {
    if (_redisConnectionTested) {
        return _redisAvailable;
    }

    try {
        const client = redisClient();
        if (!client) {
            _redisAvailable = false;
            _redisConnectionTested = true;
            return false;
        }

        await client.ping();
        _redisAvailable = true;
        _redisConnectionTested = true;
        console.log("Redis connection test successful");
        return true;
    } catch (error) {
        console.warn("Redis connection test failed:", error.message);
        console.warn("Cache operations will be disabled");
        _redisAvailable = false;
        _redisConnectionTested = true;
        return false;
    }
};

export const getCache = async <T>(key: string): Promise<T | undefined> => {
    try {
        // Test Redis connection if not already tested
        const isRedisAvailable = await testRedisConnection();
        if (!isRedisAvailable) {
            console.warn(
                `Cache GET skipped for key '${key}': Redis unavailable`
            );
            return undefined;
        }

        const result = await redisClient().get(key);
        if (result === null) {
            return undefined;
        }
        return JSON.parse(result);
    } catch (error) {
        console.warn(`Cache GET failed for key '${key}':`, error.message);
        console.warn("Falling back to no-cache mode");
        _redisAvailable = false;
        return undefined;
    }
};

export const setCache = async <T>(
    key: string,
    value: T,
    seconds: string | number
): Promise<void> => {
    try {
        // Test Redis connection if not already tested
        const isRedisAvailable = await testRedisConnection();
        if (!isRedisAvailable) {
            console.warn(
                `Cache SET skipped for key '${key}': Redis unavailable`
            );
            return;
        }

        await redisClient().set(key, JSON.stringify(value), "EX", seconds);
        console.log(`Cache SET successful for key '${key}'`);
    } catch (error) {
        console.warn(`Cache SET failed for key '${key}':`, error.message);
        console.warn("Cache operation ignored, continuing without cache");
        _redisAvailable = false;
    }
};

// Optional: Add a function to check Redis status
export const isCacheAvailable = (): boolean => {
    return _redisAvailable;
};

// Optional: Add a function to retry Redis connection
export const retryRedisConnection = async (): Promise<boolean> => {
    _redisConnectionTested = false;
    _redisAvailable = true;
    _redisClient = null;
    return await testRedisConnection();
};
