declare global {
    namespace App {
        interface Platform {
            adminFetch?: (request: Request) => Promise<Response>;
        }
    }
}

export {};
